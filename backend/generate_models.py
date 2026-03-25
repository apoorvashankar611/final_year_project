"""
generate_models.py
==================
Place this file in:  final_year_project\backend\

Then run:
    cd "C:\Users\gugul\OneDrive\Desktop\final year project\final_year_project\backend"
    python generate_models.py

It will create:
    backend\model\lr_final_model.pkl
    backend\model\transformer.pkl

No internet needed. No downloads. Runs entirely on your machine.
"""

import os, sys, re, pickle, pathlib

# ── Find dataset ──────────────────────────────────────────────
BASE = pathlib.Path(__file__).parent          # backend/
ROOT = BASE.parent                             # final_year_project/

CANDIDATES = [
    ROOT / "data" / "processed" / "ai_generated_dataset.csv",
    BASE / "ai_generated_dataset.csv",
    ROOT.parent / "Detecting-Fake-News-On-Social-Media-main" / "data" / "processed" / "ai_generated_dataset.csv",
]

dataset = None
for c in CANDIDATES:
    if c.exists():
        dataset = c
        break

if dataset is None:
    # Last resort: ask
    print("Could not find ai_generated_dataset.csv automatically.")
    print("Please drag the file into this terminal window, or type its full path:")
    path = input("Path: ").strip().strip('"')
    dataset = pathlib.Path(path)
    if not dataset.exists():
        print(f"ERROR: file not found: {dataset}")
        sys.exit(1)

print(f"Using dataset: {dataset}")

# ── Load ──────────────────────────────────────────────────────
import pandas as pd
df = pd.read_csv(dataset)
print(f"Rows: {len(df)}  |  Columns: {list(df.columns)}")
df = df[["statement", "label"]].dropna()
df["label"] = df["label"].astype(int)

# ── Preprocessing (no NLTK — pure Python) ────────────────────
STOPWORDS = {
    "i","me","my","we","our","you","your","he","him","his","she","her",
    "it","its","they","them","their","what","which","who","this","that",
    "these","those","am","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","a","an","the","and","but",
    "if","or","as","of","at","by","for","with","to","from","in","out",
    "on","up","down","not","no","so","than","too","very","can","will",
    "just","should","now","don","won","didn","doesn","isn","aren","wasn",
    "weren","couldn","shouldn","wouldn","hadn","hasn","haven","ve","ll",
    "re","d","s","t","m","y"
}

def process_text(text):
    text   = str(text).lower()
    text   = re.sub(r"[^a-z\s]", " ", text)
    tokens = text.split()
    return [t for t in tokens if t not in STOPWORDS and len(t) > 2]

# ── Train ─────────────────────────────────────────────────────
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

print("Training TF-IDF...")
tfidf = TfidfVectorizer(use_idf=True, max_df=0.85, analyzer=process_text)
X = tfidf.fit_transform(df["statement"].values)
y = df["label"].values
print(f"Features: {X.shape}")

print("Training Logistic Regression...")
lr = LogisticRegression(solver="liblinear", random_state=0,
                        C=5, max_iter=1000, class_weight="balanced")
lr.fit(X, y)

# ── Sanity check ──────────────────────────────────────────────
tests = [
    ("send me your bank details now",         1),
    ("click here your account is suspended",  1),
    ("great time at the park today",          0),
    ("see you this weekend",                  0),
]
print("\nChecks:")
for phrase, expected in tests:
    pred = lr.predict(tfidf.transform([phrase]))[0]
    print(f"  {'OK' if pred==expected else 'WRONG'}: '{phrase}' => {pred}")

# ── Save ──────────────────────────────────────────────────────
out = BASE / "model"
out.mkdir(exist_ok=True)

with open(out / "lr_final_model.pkl", "wb") as f:
    pickle.dump(lr,    f, protocol=4)
with open(out / "transformer.pkl", "wb") as f:
    pickle.dump(tfidf, f, protocol=4)

print(f"\nSaved:")
print(f"  model/lr_final_model.pkl  {(out/'lr_final_model.pkl').stat().st_size:,} bytes")
print(f"  model/transformer.pkl     {(out/'transformer.pkl').stat().st_size:,} bytes")

# ── Verify ────────────────────────────────────────────────────
lr2    = pickle.load(open(out / "lr_final_model.pkl", "rb"))
tfidf2 = pickle.load(open(out / "transformer.pkl",    "rb"))
pred   = lr2.predict(tfidf2.transform(["your bank account has been hacked verify now"]))[0]
print(f"\nVerify reload: prediction={pred} ({'Phishing' if pred==1 else 'Safe'})")
print("\nDone! Now run:  uvicorn app:app --host 127.0.0.1 --port 8000 --reload")