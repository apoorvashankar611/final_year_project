import os
import joblib
import numpy as np
from PIL import Image
from tqdm import tqdm

from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier, VotingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report

TRAIN_DIR = r"C:\Users\gugul\Downloads\archive\train"
TEST_DIR = r"C:\Users\gugul\Downloads\archive\test"
MODEL_DIR = "model"

# You can reduce these for faster training
MAX_TRAIN_IMAGES_PER_CLASS = 500
MAX_TEST_IMAGES_PER_CLASS = 500

# Small size to keep feature vector manageable
IMG_SIZE = (32, 32)

os.makedirs(MODEL_DIR, exist_ok=True)


def extract_features(img_path):
    """
    Extract simple handcrafted features from image:
    - flattened RGB pixels from resized image
    - per-channel mean
    - per-channel std
    - grayscale mean/std/min/max
    """
    try:
        img = Image.open(img_path).convert("RGB")
        img = img.resize(IMG_SIZE)

        img_array = np.array(img, dtype=np.float32) / 255.0

        # Flattened RGB pixels
        flat_pixels = img_array.flatten()

        # RGB statistics
        channel_mean = img_array.mean(axis=(0, 1))   # shape (3,)
        channel_std = img_array.std(axis=(0, 1))     # shape (3,)

        # Grayscale statistics
        gray = np.mean(img_array, axis=2)
        gray_stats = np.array([
            gray.mean(),
            gray.std(),
            gray.min(),
            gray.max()
        ], dtype=np.float32)

        # Final feature vector
        features = np.concatenate([flat_pixels, channel_mean, channel_std, gray_stats])
        return features

    except Exception as e:
        print(f"Skipping {img_path}: {e}")
        return None


def load_images_from_folder(folder_path, label, max_images=None):
    features = []
    labels = []

    image_files = [
        os.path.join(folder_path, f)
        for f in os.listdir(folder_path)
        if f.lower().endswith((".png", ".jpg", ".jpeg"))
    ]

    np.random.shuffle(image_files)

    if max_images is not None:
        image_files = image_files[:max_images]

    for img_path in tqdm(image_files, desc=f"Processing {folder_path}"):
        feat = extract_features(img_path)
        if feat is not None:
            features.append(feat)
            labels.append(label)

    return features, labels


def load_dataset(base_dir, max_images_per_class=None):
    all_features = []
    all_labels = []

    class_map = {
        "REAL": 0,
        "FAKE": 1
    }

    for class_name, label in class_map.items():
        class_folder = os.path.join(base_dir, class_name)

        if not os.path.exists(class_folder):
            print(f"Warning: folder not found -> {class_folder}")
            continue

        feats, labs = load_images_from_folder(
            class_folder,
            label,
            max_images=max_images_per_class
        )

        all_features.extend(feats)
        all_labels.extend(labs)

    return np.array(all_features, dtype=np.float32), np.array(all_labels)


print("Loading training data...")
X_train, y_train = load_dataset(TRAIN_DIR, max_images_per_class=MAX_TRAIN_IMAGES_PER_CLASS)

print("Loading testing data...")
X_test, y_test = load_dataset(TEST_DIR, max_images_per_class=MAX_TEST_IMAGES_PER_CLASS)

print("Training shape:", X_train.shape)
print("Testing shape:", X_test.shape)

print("\nTraining SVM...")
svm = SVC(kernel="linear", probability=True, random_state=42)
svm.fit(X_train, y_train)

print("\nTraining Random Forest...")
rf = RandomForestClassifier(n_estimators=100, random_state=42)
rf.fit(X_train, y_train)

print("\nTraining Logistic Regression...")
lr = LogisticRegression(max_iter=1000, random_state=42)
lr.fit(X_train, y_train)

print("\nTraining Gradient Boosting...")
gb = GradientBoostingClassifier(n_estimators=100, random_state=42)
gb.fit(X_train, y_train)

print("\nTraining Hybrid Voting Classifier...")
hybrid = VotingClassifier(
    estimators=[
        ("svm", svm),
        ("rf", rf),
        ("lr", lr),
        ("gb", gb)
    ],
    voting="soft"
)
hybrid.fit(X_train, y_train)

models = {
    "SVM": svm,
    "Random Forest": rf,
    "Logistic Regression": lr,
    "Gradient Boosting": gb,
    "Hybrid Voting": hybrid
}

for name, model in models.items():
    print(f"\n===== {name} =====")
    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    print("Accuracy:", acc)
    print(classification_report(y_test, y_pred))

joblib.dump(svm, os.path.join(MODEL_DIR, "svm.pkl"))
joblib.dump(rf, os.path.join(MODEL_DIR, "rf.pkl"))
joblib.dump(lr, os.path.join(MODEL_DIR, "lr.pkl"))
joblib.dump(gb, os.path.join(MODEL_DIR, "gb.pkl"))
joblib.dump(hybrid, os.path.join(MODEL_DIR, "hybrid.pkl"))

print("\nModels saved successfully in /model")