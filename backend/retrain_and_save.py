"""
PhishShield — retrain_and_save.py
==================================
Run this script ONCE from your backend/ folder to regenerate
lr_final_model.pkl and transformer.pkl directly on your machine.

Usage:
    cd "C:\\Users\\gugul\\OneDrive\\Desktop\\final year project\\final_year_project\\backend"
    python retrain_and_save.py

It will:
  1. Find your dataset (ai_generated_dataset.csv)
  2. Train a TF-IDF + Logistic Regression model
  3. Save lr_final_model.pkl and transformer.pkl into model/
  4. Verify the saved files load correctly
"""

import os
import sys
import pickle
import re

from text_utils import process_text   
# ── Step 0: install missing packages if needed ───────────────
def install(pkg):
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])

try:
    import pandas as pd
except ImportError:
    print("Installing pandas..."); install("pandas"); import pandas as pd

try:
    import numpy as np
except ImportError:
    print("Installing numpy..."); install("numpy"); import numpy as np

try:
    from sklearn.linear_model import LogisticRegression
    from sklearn.feature_extraction.text import TfidfVectorizer
except ImportError:
    print("Installing scikit-learn..."); install("scikit-learn")
    from sklearn.linear_model import LogisticRegression
    from sklearn.feature_extraction.text import TfidfVectorizer

try:
    import nltk
    from nltk.corpus import stopwords
    from nltk.stem import WordNetLemmatizer
except ImportError:
    print("Installing nltk..."); install("nltk")
    import nltk
    from nltk.corpus import stopwords
    from nltk.stem import WordNetLemmatizer

# ── Download NLTK data ────────────────────────────────────────
for pkg in ("wordnet", "stopwords", "punkt", "averaged_perceptron_tagger"):
    try:
        nltk.data.find(
            f"corpora/{pkg}" if pkg not in ("punkt","averaged_perceptron_tagger")
            else f"tokenizers/{pkg}"
        )
    except LookupError:
        print(f"  Downloading NLTK: {pkg}...")
        nltk.download(pkg, quiet=True)

STOPWORDS  = set(stopwords.words("english"))
lemmatizer = WordNetLemmatizer()

# ── Text preprocessing (identical to cleaning.py) ────────────
def get_pos_tag(word):
    tag = nltk.pos_tag([word])[0][1][0].upper()
    return {"J": "a", "N": "n", "V": "v", "R": "r"}.get(tag, "n")

def process_text(text):
    text   = str(text).lower()
    text   = re.sub(r"[^a-z\s]", " ", text)
    tokens = text.split()
    tokens = [t for t in tokens if t not in STOPWORDS]
    tokens = [lemmatizer.lemmatize(t, get_pos_tag(t)) for t in tokens]
    tokens = [t for t in tokens if len(t) > 2]
    return tokens

# ── Step 1: Find dataset ──────────────────────────────────────
print("\n[1] Looking for dataset...")

# Search common locations
SEARCH_PATHS = [
    # Relative to backend/
    "../data/processed/ai_generated_dataset.csv",
    "../../Detecting-Fake-News-On-Social-Media-main/data/processed/ai_generated_dataset.csv",
    # Downloads
    os.path.expanduser("~/Downloads/Detecting-Fake-News-On-Social-Media-main/data/processed/ai_generated_dataset.csv"),
    os.path.expanduser("~/Downloads/ai_generated_dataset.csv"),
    # Desktop
    os.path.expanduser("~/OneDrive/Desktop/ai_generated_dataset.csv"),
]

dataset_path = None
for p in SEARCH_PATHS:
    if os.path.exists(p):
        dataset_path = p
        print(f"    ✅ Found dataset: {p}")
        break

if not dataset_path:
    print("    ❌ Dataset not found in common locations.")
    print("    Please enter the full path to ai_generated_dataset.csv:")
    dataset_path = input("    Path: ").strip().strip('"')
    if not os.path.exists(dataset_path):
        print(f"    ❌ File not found: {dataset_path}")
        sys.exit(1)
    print(f"    ✅ Using: {dataset_path}")

# ── Step 2: Load and validate dataset ────────────────────────
print("\n[2] Loading dataset...")
df = pd.read_csv(dataset_path)
print(f"    Rows: {len(df)}, Columns: {list(df.columns)}")

# Detect statement and label columns
stmt_col   = next((c for c in df.columns if "statement" in c.lower()), None)
label_col  = next((c for c in df.columns if "label" in c.lower()), None)

if not stmt_col or not label_col:
    print(f"    ❌ Expected 'statement' and 'label' columns. Found: {list(df.columns)}")
    sys.exit(1)

df = df[[stmt_col, label_col]].dropna()
df.columns = ["statement", "label"]
df["label"] = df["label"].astype(int)

print(f"    Label distribution:\n{df['label'].value_counts().to_string()}")

# ── Step 3: Train TF-IDF + Logistic Regression ───────────────
print("\n[3] Training model (this may take 1-2 minutes)...")

tfidf = TfidfVectorizer(
    use_idf   = True,
    max_df    = 0.85,
    analyzer  = process_text   # ← uses our local process_text, NOT cleaning.py
)

X = tfidf.fit_transform(df["statement"].values)
y = df["label"].values

lr = LogisticRegression(
    verbose      = 0,
    solver       = "liblinear",
    random_state = 0,
    C            = 5,
    max_iter     = 1000,
    class_weight = "balanced"
)
lr.fit(X, y)
print("    ✅ Model trained")

from sklearn.metrics import accuracy_score

y_pred = lr.predict(X)
acc = accuracy_score(y, y_pred)

print(f"\n🎯 Accuracy: {acc * 100:.2f}%")

# Quick sanity check
test_phrases = [
    ("Hey send me your bank details urgently", 1),   # expect phishing
    ("I had a great time at the park today",   0),   # expect safe
]
print("\n    Sanity check:")
for phrase, expected in test_phrases:
    pred = lr.predict(tfidf.transform([phrase]))[0]
    ok   = "✅" if pred == expected else "⚠️ "
    print(f"    {ok} '{phrase[:45]}...' → {pred} (expected {expected})")

# ── Step 4: Save to model/ folder ────────────────────────────
print("\n[4] Saving model files...")

os.makedirs("model", exist_ok=True)

model_path       = "model/lr_final_model.pkl"
transformer_path = "model/transformer.pkl"

with open(model_path,       "wb") as f:
    pickle.dump(lr,    f, protocol=4)

with open(transformer_path, "wb") as f:
    pickle.dump(tfidf, f, protocol=4)

print(f"    ✅ Saved: {model_path}  ({os.path.getsize(model_path):,} bytes)")
print(f"    ✅ Saved: {transformer_path}  ({os.path.getsize(transformer_path):,} bytes)")

# ── Step 5: Verify files load cleanly ────────────────────────
print("\n[5] Verifying saved files...")

loaded_lr    = pickle.load(open(model_path,       "rb"))
loaded_tfidf = pickle.load(open(transformer_path, "rb"))

pred = loaded_lr.predict(loaded_tfidf.transform(["your account has been compromised click here"]))[0]
print(f"    ✅ Files load correctly. Test prediction: {pred} ({'Phishing' if pred==1 else 'Safe'})")

print("\n" + "="*55)
print("  ✅ Done! Restart uvicorn now:")
print("  uvicorn app:app --host 127.0.0.1 --port 8000 --reload")
print("="*55 + "\n")  
