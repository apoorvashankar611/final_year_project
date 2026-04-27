# ============================================================
# PhishShield Backend — MERGED
# URL + TEXT (FROZEN) + IMAGE + STEGO (from new version)
# ============================================================

import pickle
import base64
import joblib
import numpy as np
import xgboost as xgb
import pandas as pd

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from io import BytesIO
from PIL import Image

from url_feature_extractor import URLFeatureExtractor   # FROZEN — do not modify

# ────────────────────────────────────────────────────────────
# FASTAPI SETUP
# ────────────────────────────────────────────────────────────
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# LOAD URL MODEL  ← FROZEN
# ============================================================

scaler = joblib.load("scaler.pkl")

booster = xgb.Booster()
booster.load_model("xgb_model.json")

FEATURE_COLUMNS = [
    "URLLength","DomainLength","TLDLength","NoOfImage","NoOfJS","NoOfCSS",
    "NoOfSelfRef","NoOfExternalRef","IsHTTPS","HasObfuscation","HasTitle",
    "HasDescription","HasSubmitButton","HasSocialNet","HasFavicon",
    "HasCopyrightInfo","popUpWindow","Iframe","Abnormal_URL",
    "LetterToDigitRatio","Redirect_0","Redirect_1"
]

# ============================================================
# LOAD TEXT MODEL  ← FROZEN
# ============================================================

try:
    text_model = pickle.load(open("model/lr_final_model.pkl", "rb"))
    tfidf = pickle.load(open("model/transformer.pkl", "rb"))
    TEXT_LOADED = True
    print(" Text model loaded")
except Exception as e:
    TEXT_LOADED = False
    print(" Text model failed:", e)

# ============================================================
# LOAD IMAGE AI-DETECTION MODELS  ← REPLACED (new version)
# ============================================================

try:
    svm = joblib.load("model/svm.pkl")
    rf  = joblib.load("model/rf.pkl")
    lr  = joblib.load("model/lr.pkl")
    gb  = joblib.load("model/gb.pkl")
    IMAGE_LOADED = True
    print(" Image models loaded")
except Exception as e:
    IMAGE_LOADED = False
    print(" Image models failed:", e)

IMG_SIZE = (32, 32)

# ============================================================
# SCHEMAS
# ============================================================

class URLInput(BaseModel):
    url: str

class TextInput(BaseModel):
    text: str

class ImageInput(BaseModel):
    image_base64: str

# ============================================================
# IMAGE HELPER FUNCTIONS  ← REPLACED (new version)
# ============================================================

def decode_base64_image(image_base64: str):
    if "," in image_base64:
        image_base64 = image_base64.split(",")[1]
    image_bytes = base64.b64decode(image_base64)
    img = Image.open(BytesIO(image_bytes)).convert("RGB")
    return img

def extract_image_features(img: Image.Image):
    img = img.resize(IMG_SIZE)
    img_array = np.array(img, dtype=np.float32) / 255.0

    flat_pixels   = img_array.flatten()
    channel_mean  = img_array.mean(axis=(0, 1))
    channel_std   = img_array.std(axis=(0, 1))

    gray = np.mean(img_array, axis=2)
    gray_stats = np.array([
        gray.mean(), gray.std(), gray.min(), gray.max()
    ], dtype=np.float32)

    features = np.concatenate([flat_pixels, channel_mean, channel_std, gray_stats])
    return features.reshape(1, -1)

# ============================================================
# HEALTH
# ============================================================

@app.get("/")
def home():
    return {"message": "PhishShield Backend Running"}

@app.get("/health")
def health():
    return {"status": "ok"}

# ============================================================
# URL DETECTION  ← FROZEN
# ============================================================

@app.post("/predict_url")
def predict_url(data: URLInput):
    try:
        extractor = URLFeatureExtractor(data.url)
        features  = extractor.extract_model_features()

        df     = pd.DataFrame([features], columns=FEATURE_COLUMNS)
        scaled = scaler.transform(df)

        dmatrix = xgb.DMatrix(scaled, feature_names=FEATURE_COLUMNS)
        pred    = booster.predict(dmatrix)
        label   = int(round(pred[0]))

        return {
            "prediction": label,
            "result": "Legitimate" if label == 1 else "Phishing"
        }

    except Exception as e:
        return {"error": str(e)}

# ============================================================
# TEXT DETECTION  ← FROZEN
# ============================================================

@app.post("/predict-text")
def predict_text(data: TextInput):

    if not TEXT_LOADED:
        return {"error": "Text model not loaded"}

    text = data.text.strip()
    if not text:
        return {"error": "Empty text"}

    try:
        X    = tfidf.transform([text])
        pred = int(text_model.predict(X)[0])

        try:
            prob = text_model.predict_proba(X)[0][1]
        except:
            prob = 1.0 if pred == 1 else 0.0

        return {
            "prediction": pred,
            "result":     "Phishing" if pred == 1 else "Safe",
            "confidence": round(float(prob), 3)
        }

    except Exception as e:
        return {"error": str(e)}

# ============================================================
# IMAGE DETECTION (AI-generated vs Real)  ← REPLACED (new version)
# ============================================================

@app.post("/predict_image")
def predict_image(input_data: ImageInput):

    if not IMAGE_LOADED:
        return {
            "prediction": "Error",
            "confidence": 0,
            "error": "Image models not loaded"
        }

    try:
        img      = decode_base64_image(input_data.image_base64)
        features = extract_image_features(img)

        p1 = int(svm.predict(features)[0])
        p2 = int(rf.predict(features)[0])
        p3 = int(lr.predict(features)[0])
        p4 = int(gb.predict(features)[0])

        preds      = [p1, p2, p3, p4]
        count_ai   = preds.count(1)
        count_real = preds.count(0)

        # Tie breaker → safer to assume Real
        final = 1 if count_ai > count_real else 0

        confidence = (max(count_ai, count_real) / len(preds)) * 100

        return {
            "prediction": "AI Generated" if final == 1 else "Real",
            "confidence": round(confidence, 2),
            "votes": {
                "svm":                 p1,
                "random_forest":       p2,
                "logistic_regression": p3,
                "gradient_boosting":   p4,
            }
        }

    except Exception as e:
        return {
            "prediction": "Error",
            "confidence": 0,
            "error": str(e)
        }

# ============================================================
# STEGANOGRAPHY DETECTION  ← NEW (added from new version)
# LSB Chi-square analysis — no model needed, pure statistical.
# Natural images → high chi2 (random LSBs).
# Stego images   → low chi2  (uniform/patterned LSBs).
# ============================================================

@app.post("/detect_stego")
def detect_stego(input_data: ImageInput):
    try:
        img       = decode_base64_image(input_data.image_base64)
        img_array = np.array(img)

        lsb_plane = img_array & 1

        chi2_scores = {}

        for i, ch in enumerate(["R", "G", "B"]):
            lsbs = lsb_plane[:, :, i].flatten()
            observed = np.bincount(lsbs, minlength=2).astype(float)
            expected = np.array([len(lsbs) / 2] * 2)
            chi2 = float(np.sum((observed - expected) ** 2 / expected))
            chi2_scores[ch] = round(chi2, 4)

        avg_chi2 = float(np.mean(list(chi2_scores.values())))
        is_stego = avg_chi2 < 100

        if is_stego:
            return {
                "is_stego": True,
                "risk": "High",
                "result": "Hidden Data Detected",
                "explanation": "This image may contain concealed data using steganography techniques.",
                "possible_attacks": [
                    "Hidden phishing URLs",
                    "Malware payload delivery",
                    "Command & control communication",
                    "Data exfiltration"
                ],
                "avg_chi2": round(avg_chi2, 2)
            }
        else:
            return {
                "is_stego": False,
                "risk": "Low",
                "result": "Clean",
                "explanation": "No statistical evidence of hidden data.",
                "avg_chi2": round(avg_chi2, 2)
            }

    except Exception as e:
        return {"error": str(e)}

# ============================================================
# COMBINED IMAGE RISK  ← NEW (added from new version)
# ============================================================

@app.post("/analyze_image_full")
def analyze_image_full(input_data: ImageInput):
    try:
        ai_result    = predict_image(input_data)
        stego_result = detect_stego(input_data)

        if stego_result.get("is_stego"):
            final_risk = "High"
        elif ai_result.get("prediction") == "AI Generated":
            final_risk = "Medium"
        else:
            final_risk = "Low"

        return {
            "final_risk":     final_risk,
            "ai_analysis":    ai_result,
            "stego_analysis": stego_result
        }

    except Exception as e:
        return {"error": str(e)}