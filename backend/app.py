from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
import re
import base64

from io import BytesIO
from PIL import Image

from url_feature_extractor import URLFeatureExtractor

# ============================================================
# INITIALIZE FASTAPI
# ============================================================

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# LOAD URL PHISHING MODEL
# ============================================================

scaler = joblib.load("scaler.pkl")
booster = xgb.Booster()
booster.load_model("xgb_model.json")

FEATURE_COLUMNS = [
    "URLLength", "DomainLength", "TLDLength", "NoOfImage", "NoOfJS", "NoOfCSS",
    "NoOfSelfRef", "NoOfExternalRef", "IsHTTPS", "HasObfuscation", "HasTitle",
    "HasDescription", "HasSubmitButton", "HasSocialNet", "HasFavicon",
    "HasCopyrightInfo", "popUpWindow", "Iframe", "Abnormal_URL",
    "LetterToDigitRatio", "Redirect_0", "Redirect_1"
]

# ============================================================
# LOAD IMAGE AI-DETECTION MODELS
# ============================================================

svm = joblib.load("model/svm.pkl")
rf = joblib.load("model/rf.pkl")
lr = joblib.load("model/lr.pkl")
gb = joblib.load("model/gb.pkl")

IMG_SIZE = (32, 32)

# ============================================================
# URL HEURISTIC CHECK FOR AI-GENERATED / SUSPICIOUS URLS
# ============================================================

def detect_ai_generated_suspicion(url: str) -> bool:
    suspicious_flags = []

    if len(url) > 100:
        suspicious_flags.append("long_url")

    try:
        from urllib.parse import urlparse
        domain = urlparse(url).netloc
        if domain.count("-") >= 3:
            suspicious_flags.append("multiple_hyphens")
    except Exception:
        pass

    digits = sum(c.isdigit() for c in url)
    if len(url) > 0 and (digits / len(url)) > 0.30:
        suspicious_flags.append("high_digit_density")

    random_pattern = re.compile(
        r'(?=[a-zA-Z0-9]*[a-zA-Z])(?=[a-zA-Z0-9]*[0-9])[a-zA-Z0-9]{8,}'
    )
    if random_pattern.search(url):
        suspicious_flags.append("random_char_sequence")

    redirect_pattern = re.compile(
        r'(redirect|/go/|/out/|/click/|/track/)', re.IGNORECASE
    )
    if len(redirect_pattern.findall(url)) >= 2:
        suspicious_flags.append("excessive_redirects")

    letters = sum(c.isalpha() for c in url)
    ratio = letters / (digits + 1e-5)
    if ratio < 1.5:
        suspicious_flags.append("abnormal_letter_digit_ratio")

    return len(suspicious_flags) >= 2

# ============================================================
# REQUEST SCHEMAS
# ============================================================

class URLFeatures(BaseModel):
    URLLength: int
    DomainLength: int
    TLDLength: int
    NoOfImage: int
    NoOfJS: int
    NoOfCSS: int
    NoOfSelfRef: int
    NoOfExternalRef: int
    IsHTTPS: int
    HasObfuscation: int
    HasTitle: int
    HasDescription: int
    HasSubmitButton: int
    HasSocialNet: int
    HasFavicon: int
    HasCopyrightInfo: int
    popUpWindow: int
    Iframe: int
    Abnormal_URL: int
    LetterToDigitRatio: float
    Redirect_0: int
    Redirect_1: int


class URLInput(BaseModel):
    url: str


class ImageInput(BaseModel):
    image_base64: str

# ============================================================
# IMAGE HELPER FUNCTIONS
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

    flat_pixels = img_array.flatten()
    channel_mean = img_array.mean(axis=(0, 1))
    channel_std = img_array.std(axis=(0, 1))

    gray = np.mean(img_array, axis=2)
    gray_stats = np.array([
        gray.mean(),
        gray.std(),
        gray.min(),
        gray.max()
    ], dtype=np.float32)

    features = np.concatenate([flat_pixels, channel_mean, channel_std, gray_stats])
    return features.reshape(1, -1)

# ============================================================
# ENDPOINT: PREDICT FROM STRUCTURED URL FEATURES
# ============================================================

@app.post("/predict")
def predict(features: URLFeatures):
    try:
        input_df = pd.DataFrame([features.dict()], columns=FEATURE_COLUMNS)
        scaled_input = scaler.transform(input_df)
        dmatrix = xgb.DMatrix(scaled_input, feature_names=FEATURE_COLUMNS)
        pred = booster.predict(dmatrix)
        label = int(round(pred[0]))

        return {
            "prediction": label,
            "result": "Legitimate" if label == 1 else "Phishing"
        }
    except Exception as e:
        return {"error": str(e)}

# ============================================================
# ENDPOINT: PREDICT FROM RAW URL
# ============================================================

@app.post("/predict_url")
def predict_from_url(input_data: URLInput):
    try:
        url = input_data.url
        ai_suspicion = detect_ai_generated_suspicion(url)

        extractor = URLFeatureExtractor(url)
        features = extractor.extract_model_features()

        if "error" in features:
            return {
                "error": features["error"],
                "ai_generated_suspicion": ai_suspicion
            }

        input_df = pd.DataFrame([features], columns=FEATURE_COLUMNS)
        scaled_input = scaler.transform(input_df)

        dmatrix = xgb.DMatrix(scaled_input, feature_names=FEATURE_COLUMNS)
        pred = booster.predict(dmatrix)
        label = int(round(pred[0]))

        return {
            "features": features,
            "prediction": label,
            "result": "Legitimate" if label == 1 else "Phishing",
            "ai_generated_suspicion": ai_suspicion
        }

    except Exception as e:
        return {"error": str(e)}

# ============================================================
# ENDPOINT: PREDICT IMAGE (AI GENERATED / REAL)
# ============================================================

@app.post("/predict_image")
def predict_image(input_data: ImageInput):
    try:
        # Decode + feature extraction
        img = decode_base64_image(input_data.image_base64)
        features = extract_image_features(img)

        # Model predictions
        p1 = int(svm.predict(features)[0])
        p2 = int(rf.predict(features)[0])
        p3 = int(lr.predict(features)[0])
        p4 = int(gb.predict(features)[0])

        # Voting logic
        preds = [p1, p2, p3, p4]
        count_ai = preds.count(1)
        count_real = preds.count(0)

        # Final decision
        if count_ai > count_real:
            final = 1
        elif count_real > count_ai:
            final = 0
        else:
            # Tie breaker → safer to assume Real
            final = 0

        # Confidence
        confidence = (max(count_ai, count_real) / len(preds)) * 100

        return {
            "prediction": "AI Generated" if final == 1 else "Real",
            "confidence": round(confidence, 2),
            "votes": {
                "svm": p1,
                "random_forest": p2,
                "logistic_regression": p3,
                "gradient_boosting": p4
            }
        }

    except Exception as e:
        return {
            "prediction": "Error",
            "confidence": 0,
            "error": str(e)
        }


# ============================================================
# ROOT ENDPOINT
# ============================================================

@app.get("/")
def read_root():
    return {"message": "PhishShield API is running 🚀"}
