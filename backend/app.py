# ============================================================
# PhishShield Backend - app.py
# MODIFIED FOR:
#   Requirement 2: AI-generated / suspicious URL detection
#   Requirement 3: Multi-dataset support structure (see comments)
# ============================================================

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
import re

from url_feature_extractor import URLFeatureExtractor

# ✅ Initialize FastAPI app
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ Load the scaler and XGBoost model
scaler = joblib.load("scaler.pkl")
booster = xgb.Booster()
booster.load_model("xgb_model.json")

# ✅ Define the expected feature columns in correct order
FEATURE_COLUMNS = [
    "URLLength", "DomainLength", "TLDLength", "NoOfImage", "NoOfJS", "NoOfCSS",
    "NoOfSelfRef", "NoOfExternalRef", "IsHTTPS", "HasObfuscation", "HasTitle",
    "HasDescription", "HasSubmitButton", "HasSocialNet", "HasFavicon",
    "HasCopyrightInfo", "popUpWindow", "Iframe", "Abnormal_URL",
    "LetterToDigitRatio", "Redirect_0", "Redirect_1"
]

# ============================================================
# REQUIREMENT 3: MULTI-DATASET SUPPORT
#
# The model is currently trained on one phishing URL dataset.
# To support additional datasets in future training, follow
# this pattern:
#
#   DATASET REGISTRY — add new dataset paths/configs here:
#     DATASETS = {
#         "phishing_urls":   "data/phishing_urls.csv",
#         "spam_urls":       "data/spam_urls.csv",        # Future
#         "ai_phishing_urls":"data/ai_phishing_urls.csv", # Future
#     }
#
#   MODEL REGISTRY — load per-dataset models here:
#     MODELS = {
#         "phishing_urls":    {"scaler": "scaler.pkl",          "model": "xgb_model.json"},
#         "spam_urls":        {"scaler": "scaler_spam.pkl",     "model": "xgb_spam.json"},     # Future
#         "ai_phishing_urls": {"scaler": "scaler_ai.pkl",       "model": "xgb_ai.json"},       # Future
#     }
#
# Each model can be retrained independently on its own dataset.
# Predictions can be ensembled or run in parallel in /predict_url.
# ============================================================


# ============================================================
# REQUIREMENT 2: AI-GENERATED / SUSPICIOUS URL DETECTION
#
# This function analyses the raw URL string for patterns that
# are commonly found in machine-generated phishing URLs:
#   - Excessive length
#   - Random character sequences (low readability)
#   - Multiple hyphens
#   - High digit density
#   - Abnormal letter-to-digit ratio
#   - Redirect chains in the URL path
# ============================================================

def detect_ai_generated_suspicion(url: str) -> bool:
    """
    Heuristic analysis of a URL to detect AI-generated phishing patterns.
    Returns True if the URL exhibits suspicious characteristics.

    Pattern checks performed:
    1. URL length > 100 characters
    2. Three or more consecutive hyphens in the domain
    3. High digit density (>30% of URL characters are digits)
    4. Random-looking substrings: 8+ consecutive alphanumeric characters
       with mixed letters and digits (typical of auto-generated tokens)
    5. Multiple redirect indicators in the URL path (/redirect, /go/, etc.)
    6. Abnormal letter-to-digit ratio (<1.5, meaning very few letters
       relative to digits — unusual in human-written URLs)
    """
    suspicious_flags = []

    # Check 1: Very long URL (common in obfuscated / AI-generated links)
    if len(url) > 100:
        suspicious_flags.append("long_url")

    # Check 2: Multiple hyphens in the domain part
    try:
        from urllib.parse import urlparse
        domain = urlparse(url).netloc
        if domain.count("-") >= 3:
            suspicious_flags.append("multiple_hyphens")
    except Exception:
        pass

    # Check 3: High digit density — more than 30% of URL chars are digits
    digits = sum(c.isdigit() for c in url)
    if len(url) > 0 and (digits / len(url)) > 0.30:
        suspicious_flags.append("high_digit_density")

    # Check 4: Random alphanumeric sequences (8+ chars mixing letters & digits)
    # These are typical of AI-generated tokens or hashed paths
    random_pattern = re.compile(r'(?=[a-zA-Z0-9]*[a-zA-Z])(?=[a-zA-Z0-9]*[0-9])[a-zA-Z0-9]{8,}')
    if random_pattern.search(url):
        suspicious_flags.append("random_char_sequence")

    # Check 5: Redirect chain patterns in the URL (e.g., ?redirect=, /go/, /out/)
    redirect_pattern = re.compile(r'(redirect|/go/|/out/|/click/|/track/)', re.IGNORECASE)
    if len(redirect_pattern.findall(url)) >= 2:
        suspicious_flags.append("excessive_redirects")

    # Check 6: Abnormal letter-to-digit ratio
    letters = sum(c.isalpha() for c in url)
    ratio = letters / (digits + 1e-5)  # avoid division by zero
    if ratio < 1.5:
        suspicious_flags.append("abnormal_letter_digit_ratio")

    # Flag as suspicious if 2 or more checks trigger
    # (single checks can occur in legitimate URLs; combinations are more reliable)
    return len(suspicious_flags) >= 2


# ✅ Define input model schema for direct feature input
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


# ✅ Define input model for raw URL input
class URLInput(BaseModel):
    url: str


# ✅ Predict directly from structured features (unchanged)
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


# ✅ Predict from raw URL using feature extractor
# MODIFIED: Now also returns ai_generated_suspicion field (Requirement 2)
@app.post("/predict_url")
def predict_from_url(input_data: URLInput):
    try:
        url = input_data.url

        # REQUIREMENT 2: Run AI/suspicious URL heuristic analysis FIRST
        # This is fast (no network calls) and runs on raw URL patterns only
        ai_suspicion = detect_ai_generated_suspicion(url)

        # Extract page features using custom extractor (makes HTTP request to URL)
        extractor = URLFeatureExtractor(url)
        features = extractor.extract_model_features()

        if "error" in features:
            # Even if page fetch fails, we still return the AI suspicion result
            return {
                "error": features["error"],
                "ai_generated_suspicion": ai_suspicion
            }

        # Convert to DataFrame aligned with expected column names
        input_df = pd.DataFrame([features], columns=FEATURE_COLUMNS)

        # Scale features
        scaled_input = scaler.transform(input_df)

        # Run XGBoost model prediction
        dmatrix = xgb.DMatrix(scaled_input, feature_names=FEATURE_COLUMNS)
        pred = booster.predict(dmatrix)
        label = int(round(pred[0]))

        # -------------------------------------------------------
        # REQUIREMENT 2: Include ai_generated_suspicion in response
        # The frontend reads this field to show the AI badge.
        #
        # REQUIREMENT 3 (future): To use additional dataset models,
        # call them here and combine/ensemble their predictions:
        #
        #   spam_pred = spam_booster.predict(dmatrix)
        #   ai_phish_pred = ai_booster.predict(dmatrix)
        #   combined_label = ensemble([label, spam_pred, ai_phish_pred])
        # -------------------------------------------------------
        return {
            "features": features,
            "prediction": label,
            "result": "Legitimate" if label == 1 else "Phishing",
            "ai_generated_suspicion": ai_suspicion  # NEW field (Requirement 2)
        }
    except Exception as e:
        return {"error": str(e)}


# ✅ Root endpoint
@app.get("/")
def read_root():
    return {"message": "PhishShield API is running 🚀"}