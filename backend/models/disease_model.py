import os
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models, applications
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
import cv2
import json
from tqdm import tqdm
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent

class DiseaseModel:
    def __init__(self, model_path='models_saved/efficientnet_disease_model.h5'):
        self.model_path = self._resolve_model_path(model_path)
        self.model = None
        # Updated class names to match your dataset
        self.class_names = ['Bud_Root', 'Bud_Root_Dropping', 'Gray_Leaf_Spot', 'Healthy', 'Leaf_Rot', 'Stem_Bleeding']
        self.img_size = (224, 224)
        self.prototype_cache_path = BACKEND_DIR / 'models_saved' / 'feature_prototypes.npz'
        self.dataset_dir = BACKEND_DIR / 'organized_dataset' / 'train'
        self.feature_extractor = None
        self.class_prototypes = None
        self.load_model()

    @staticmethod
    def _resolve_model_path(model_path):
        supplied_path = Path(model_path)
        candidate_paths = []

        if supplied_path.is_absolute():
            candidate_paths.append(supplied_path)
        else:
            candidate_paths.extend([
                Path.cwd() / supplied_path,
                BACKEND_DIR / supplied_path,
                PROJECT_ROOT / supplied_path,
            ])

            model_name = supplied_path.name
            parent_name = supplied_path.parent if str(supplied_path.parent) != '.' else Path('models_saved')
            if model_name == 'efficientnet_disease_model.h5':
                candidate_paths.extend([
                    BACKEND_DIR / parent_name / 'best_model.h5',
                    PROJECT_ROOT / parent_name / 'best_model.h5',
                ])

        for candidate in candidate_paths:
            if candidate.exists():
                return str(candidate.resolve())

        # Prefer the backend-local training output when nothing exists yet.
        default_backend_path = BACKEND_DIR / 'models_saved' / supplied_path.name
        if supplied_path.name == 'efficientnet_disease_model.h5':
            best_model_path = BACKEND_DIR / 'models_saved' / 'best_model.h5'
            if best_model_path.exists():
                return str(best_model_path.resolve())

        return str(default_backend_path.resolve())
    
    def load_model(self):
        if os.path.exists(self.model_path):
            try:
                self.model = tf.keras.models.load_model(self.model_path)
                print(f"Model loaded from {self.model_path}")
                # Load class names if available
                class_names_path = os.path.join(os.path.dirname(self.model_path), 'class_names.json')
                if os.path.exists(class_names_path):
                    with open(class_names_path, 'r') as f:
                        self.class_names = json.load(f)
                    print(f"Loaded class names: {self.class_names}")
            except Exception as e:
                print(f"Error loading model: {e}")
                self.model = None
        else:
            print("Model not found. Train the model first.")
            self.model = None

    def _get_feature_extractor(self):
        if self.feature_extractor is None:
            self.feature_extractor = applications.MobileNetV2(
                include_top=False,
                weights='imagenet',
                pooling='avg',
                input_shape=(self.img_size[0], self.img_size[1], 3)
            )
        return self.feature_extractor

    def _prepare_feature_batch(self, images):
        batch = []
        for image in images:
            resized = cv2.resize(image, self.img_size).astype(np.float32)
            if np.max(resized) <= 1.0:
                resized = resized * 255.0
            batch.append(resized)
        batch = np.stack(batch, axis=0)
        return tf.keras.applications.mobilenet_v2.preprocess_input(batch)

    def _extract_embedding(self, image):
        extractor = self._get_feature_extractor()
        batch = self._prepare_feature_batch([image])
        embedding = extractor.predict(batch, verbose=0)[0]
        norm = np.linalg.norm(embedding)
        return embedding / norm if norm > 0 else embedding

    def _load_or_build_class_prototypes(self):
        if self.class_prototypes is not None:
            return self.class_prototypes

        if self.prototype_cache_path.exists():
            cache = np.load(self.prototype_cache_path, allow_pickle=True)
            cached_class_names = cache['class_names'].tolist()
            if cached_class_names == self.class_names:
                self.class_prototypes = cache['prototypes']
                return self.class_prototypes

        if not self.dataset_dir.exists():
            raise ValueError(f"Prototype dataset not found at {self.dataset_dir}")

        prototypes = []
        for class_name in self.class_names:
            class_dir = self.dataset_dir / class_name
            image_paths = sorted(class_dir.glob('*'))
            embeddings = []
            batch_images = []
            for image_path in image_paths:
                image = cv2.imread(str(image_path))
                if image is None:
                    continue
                batch_images.append(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
                if len(batch_images) == 32:
                    embeddings.append(self._get_feature_extractor().predict(
                        self._prepare_feature_batch(batch_images),
                        verbose=0
                    ))
                    batch_images = []
            if batch_images:
                embeddings.append(self._get_feature_extractor().predict(
                    self._prepare_feature_batch(batch_images),
                    verbose=0
                ))

            if not embeddings:
                prototypes.append(np.zeros((1280,), dtype=np.float32))
                continue

            class_embeddings = np.concatenate(embeddings, axis=0)
            prototype = np.mean(class_embeddings, axis=0)
            norm = np.linalg.norm(prototype)
            prototypes.append(prototype / norm if norm > 0 else prototype)

        self.class_prototypes = np.stack(prototypes, axis=0)
        np.savez(
            self.prototype_cache_path,
            class_names=np.array(self.class_names, dtype=object),
            prototypes=self.class_prototypes
        )
        return self.class_prototypes

    def _prototype_predict(self, image):
        prototypes = self._load_or_build_class_prototypes()
        embedding = self._extract_embedding(image)
        similarities = prototypes @ embedding
        scaled_scores = np.exp(similarities * 8.0)
        probabilities = scaled_scores / np.sum(scaled_scores)
        predicted_class = int(np.argmax(probabilities))
        return {
            'disease_name': self.class_names[predicted_class].replace('_', ' '),
            'confidence': float(probabilities[predicted_class]),
            'all_predictions': {
                self.class_names[i]: float(probabilities[i])
                for i in range(len(self.class_names))
            }
        }
    
    def create_model(self, num_classes=6):
        base_model = applications.EfficientNetB0(
            include_top=False,
            weights='imagenet',
            input_shape=(224, 224, 3)
        )
        base_model.trainable = False
        
        x = base_model.output
        x = layers.GlobalAveragePooling2D()(x)
        x = layers.Dense(512, activation='relu', kernel_regularizer=tf.keras.regularizers.l2(0.001))(x)
        x = layers.BatchNormalization()(x)
        x = layers.Dropout(0.5)(x)
        x = layers.Dense(256, activation='relu', kernel_regularizer=tf.keras.regularizers.l2(0.001))(x)
        x = layers.BatchNormalization()(x)
        x = layers.Dropout(0.3)(x)
        predictions = layers.Dense(num_classes, activation='softmax')(x)
        
        model = models.Model(inputs=base_model.input, outputs=predictions)
        return model
    
    def predict(self, image):
        # Preprocess image
        if isinstance(image, str):
            image = cv2.imread(image)
            image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        model_result = None
        if self.model is not None:
            classifier_image = cv2.resize(image, self.img_size).astype(np.float32)
            if np.max(classifier_image) > 1.0:
                classifier_image = classifier_image / 255.0
            classifier_image = np.expand_dims(classifier_image, axis=0)

            predictions = self.model.predict(classifier_image, verbose=0)
            predicted_class = np.argmax(predictions[0])
            confidence = np.max(predictions[0])

            disease_name = self.class_names[predicted_class]
            model_result = {
                'disease_name': disease_name.replace('_', ' '),
                'confidence': float(confidence),
                'all_predictions': {
                    self.class_names[i]: float(predictions[0][i])
                    for i in range(len(self.class_names))
                }
            }

        if model_result is None or model_result['confidence'] < 0.55:
            prototype_result = self._prototype_predict(image)
            if model_result is None:
                return prototype_result

            blended_predictions = {}
            for class_name in self.class_names:
                blended_predictions[class_name] = (
                    0.35 * model_result['all_predictions'].get(class_name, 0.0) +
                    0.65 * prototype_result['all_predictions'].get(class_name, 0.0)
                )

            best_class = max(blended_predictions, key=blended_predictions.get)
            return {
                'disease_name': best_class.replace('_', ' '),
                'confidence': float(blended_predictions[best_class]),
                'all_predictions': blended_predictions
            }

        return model_result
    
    def get_class_names(self):
        return self.class_names
    
    def set_class_names(self, class_names):
        self.class_names = class_names

# Standalone training function
def train_model():
    from train_model import main
    main()

if __name__ == "__main__":
    train_model()
