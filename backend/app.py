# ============================================================
# PhishShield Backend — FINAL (URL + TEXT WORKING)
# ============================================================

import pickle
import re
import joblib
import xgboost as xgb
import pandas as pd

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from url_feature_extractor import URLFeatureExtractor

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
# LOAD URL MODEL
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
# LOAD TEXT MODEL
# ============================================================

try:
    text_model = pickle.load(open("model/lr_final_model.pkl", "rb"))
    tfidf = pickle.load(open("model/transformer.pkl", "rb"))
    TEXT_LOADED = True
    print("✅ Text model loaded")
except Exception as e:
    TEXT_LOADED = False
    print("❌ Text model failed:", e)

# ============================================================
# SCHEMAS
# ============================================================

class URLInput(BaseModel):
    url: str

class TextInput(BaseModel):
    text: str

# ============================================================
# HEALTH
# ============================================================
@app.get("/")
def home():
    return {"message": "PhishShield Backend Running 🚀"}  

@app.get("/health")
def health():
    return {"status": "ok"}

# ============================================================
# URL DETECTION
# ============================================================

@app.post("/predict_url")
def predict_url(data: URLInput):
    try:
        extractor = URLFeatureExtractor(data.url)
        features = extractor.extract_model_features()

        df = pd.DataFrame([features], columns=FEATURE_COLUMNS)
        scaled = scaler.transform(df)

        dmatrix = xgb.DMatrix(scaled, feature_names=FEATURE_COLUMNS)
        pred = booster.predict(dmatrix)

        label = int(round(pred[0]))

        return {
            "prediction": label,
            "result": "Legitimate" if label == 1 else "Phishing"
        }

    except Exception as e:
        return {"error": str(e)}

# ============================================================
# TEXT DETECTION
# ============================================================

@app.post("/predict-text")
def predict_text(data: TextInput):

    if not TEXT_LOADED:
        return {"error": "Text model not loaded"}

    text = data.text.strip()

    if not text:
        return {"error": "Empty text"}

    try:
        X = tfidf.transform([text])
        pred = int(text_model.predict(X)[0])

        try:
            prob = text_model.predict_proba(X)[0][1]
        except:
            prob = 1.0 if pred == 1 else 0.0

        return {
            "prediction": pred,
            "result": "Phishing" if pred == 1 else "Safe",
            "confidence": round(float(prob), 3)
        }

    except Exception as e:
        return {"error": str(e)}