#!/usr/bin/env python3
"""
Standalone script to train the coconut disease detection model
This script is customized for the Coconut Tree Disease dataset with specific class names
"""

import os
import sys
import json
import shutil
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models, applications
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.callbacks import (
    EarlyStopping, 
    ReduceLROnPlateau, 
    ModelCheckpoint,
    TensorBoard,
    CSVLogger
)
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight
import matplotlib.pyplot as plt
import argparse
from pathlib import Path
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

PROJECT_ROOT = Path(__file__).resolve().parents[2]

# Add the backend directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

class CoconutDiseaseTrainer:
    def __init__(self, 
                 dataset_path='Coconut Tree Disease dataset',
                 output_dir='models_saved',
                 img_size=(224, 224),
                 batch_size=32,
                 epochs=50):
        self.dataset_path = self._resolve_dataset_path(dataset_path)
        self.output_dir = output_dir
        self.img_size = img_size
        self.batch_size = batch_size
        self.epochs = epochs
        
        # Define class names based on your dataset structure
        self.class_names = [
            'Bud Root Dropping',
            'Bud Root', 
            'Gray Leaf Spot',
            'Leaf Rot',
            'Stem Bleeding',
            'normal'
        ]
        
        # Create class mapping for consistent naming
        self.class_mapping = {
            'Bud Root Dropping': 'Bud_Root_Dropping',
            'Bud Root': 'Bud_Root',
            'Gray Leaf Spot': 'Gray_Leaf_Spot',
            'Leaf Rot': 'Leaf_Rot',
            'Stem Bleeding': 'Stem_Bleeding',
            'normal': 'Healthy'
        }
        
        # Create output directory
        os.makedirs(output_dir, exist_ok=True)
        os.makedirs('logs', exist_ok=True)
        
        self.model = None
        self.history = None
        self.training_histories = []
        
        print("=" * 70)
        print("🌴 COCONUT DISEASE DETECTION - MODEL TRAINING")
        print("=" * 70)
        print(f"Dataset Path: {self.dataset_path}")
        print(f"Classes found: {self.class_names}")
        print(f"Class Mapping: {self.class_mapping}")
        print(f"Image Size: {self.img_size}")
        print(f"Batch Size: {self.batch_size}")
        print(f"Epochs: {self.epochs}")
        print("=" * 70)

    @staticmethod
    def _resolve_dataset_path(dataset_path):
        """Resolve a dataset path relative to the project as well as the CWD."""
        supplied_path = Path(dataset_path)
        candidates = [supplied_path]

        if not supplied_path.is_absolute():
            candidates.append(PROJECT_ROOT / supplied_path)

            if supplied_path.name.casefold() == 'coconut tree disease dataset':
                candidates.append(PROJECT_ROOT / 'Coconut Tree Disease Dataset')

        for candidate in candidates:
            if candidate.is_dir():
                return str(candidate.resolve())

        return str(supplied_path)

    def _get_class_path(self, class_name):
        """Find the source folder for a logical class name."""
        aliases = {
            'Bud Root': ('Bud Root', 'Bud Rot'),
            'normal': ('normal', 'Normal'),
        }

        for folder_name in aliases.get(class_name, (class_name,)):
            class_path = Path(self.dataset_path) / folder_name
            if class_path.is_dir():
                return class_path

        return Path(self.dataset_path) / class_name
    
    def prepare_dataset(self):
        """Prepare dataset by organizing into train/val/test splits"""
        print("\n📁 Preparing Dataset...")
        
        # Create organized dataset structure
        organized_path = 'organized_dataset'
        if os.path.exists(organized_path):
            print("Organized dataset already exists. Skipping preparation...")
            return organized_path
        
        os.makedirs(organized_path, exist_ok=True)
        
        # Create train, val, test directories
        for split in ['train', 'val', 'test']:
            split_path = os.path.join(organized_path, split)
            os.makedirs(split_path, exist_ok=True)
            for class_name in self.class_names:
                class_dir = os.path.join(split_path, self.class_mapping[class_name])
                os.makedirs(class_dir, exist_ok=True)
        
        # Collect all image files
        print("Collecting images...")
        image_files = []
        
        for class_name in self.class_names:
            class_path = self._get_class_path(class_name)
            if class_path.is_dir():
                for img_file in os.listdir(class_path):
                    if img_file.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.gif')):
                        image_files.append({
                            'path': str(class_path / img_file),
                            'class': class_name,
                            'filename': img_file
                        })
        
        print(f"Found {len(image_files)} images across {len(self.class_names)} classes")
        
        # Check class distribution
        class_counts = {}
        for img in image_files:
            class_counts[img['class']] = class_counts.get(img['class'], 0) + 1
        
        print("\nClass Distribution:")
        for class_name, count in class_counts.items():
            print(f"  {class_name}: {count} images")
        
        # Split data
        print("\nSplitting data into train/val/test...")
        
        # Group by class for stratified split
        train_files = []
        val_files = []
        test_files = []
        
        for class_name in self.class_names:
            class_images = [img for img in image_files if img['class'] == class_name]
            
            if len(class_images) == 0:
                print(f"Warning: No images found for class {class_name}")
                continue
            
            # Split: 70% train, 15% val, 15% test
            train_temp, test_temp = train_test_split(
                class_images, 
                test_size=0.3, 
                random_state=42,
                shuffle=True
            )
            
            val_temp, test_temp = train_test_split(
                test_temp,
                test_size=0.5,
                random_state=42,
                shuffle=True
            )
            
            train_files.extend(train_temp)
            val_files.extend(val_temp)
            test_files.extend(test_temp)
        
        # Copy files to organized structure
        print("Copying files to organized structure...")
        self._copy_files_to_organized(train_files, organized_path, 'train')
        self._copy_files_to_organized(val_files, organized_path, 'val')
        self._copy_files_to_organized(test_files, organized_path, 'test')
        
        print(f"Dataset organized at: {organized_path}")
        print(f"  Train: {len(train_files)} images")
        print(f"  Val: {len(val_files)} images")
        print(f"  Test: {len(test_files)} images")
        
        return organized_path
    
    def _copy_files_to_organized(self, files, organized_path, split):
        """Copy files to organized structure"""
        for img in files:
            source_path = img['path']
            class_name = self.class_mapping[img['class']]
            dest_dir = os.path.join(organized_path, split, class_name)
            dest_path = os.path.join(dest_dir, img['filename'])
            
            try:
                shutil.copy2(source_path, dest_path)
            except Exception as e:
                print(f"Warning: Could not copy {source_path}: {e}")
    
    def create_model(self, num_classes=6):
        """Create EfficientNetB0 model with transfer learning"""
        print("\n🤖 Creating Model...")
        
        # Base model with pre-trained weights
        base_model = applications.EfficientNetB0(
            include_top=False,
            weights='imagenet',
            input_shape=(self.img_size[0], self.img_size[1], 3)
        )
        
        # Freeze base model layers initially
        base_model.trainable = False
        
        # Add custom classification head
        x = base_model.output
        x = layers.GlobalAveragePooling2D()(x)
        
        # Dense layers with regularization
        x = layers.Dense(512, activation='relu', kernel_regularizer=tf.keras.regularizers.l2(0.001))(x)
        x = layers.BatchNormalization()(x)
        x = layers.Dropout(0.5)(x)
        
        x = layers.Dense(256, activation='relu', kernel_regularizer=tf.keras.regularizers.l2(0.001))(x)
        x = layers.BatchNormalization()(x)
        x = layers.Dropout(0.3)(x)
        
        # Output layer
        predictions = layers.Dense(num_classes, activation='softmax')(x)
        
        model = models.Model(inputs=base_model.input, outputs=predictions)
        
        # Compile model
        model.compile(
            optimizer=Adam(learning_rate=0.001),
            loss=tf.keras.losses.CategoricalCrossentropy(label_smoothing=0.1),
            metrics=[
                'accuracy',
                tf.keras.metrics.Precision(name='precision'),
                tf.keras.metrics.Recall(name='recall'),
                tf.keras.metrics.AUC(name='auc')
            ]
        )
        
        self.model = model
        print("Model created successfully!")
        print(f"Total parameters: {model.count_params():,}")
        print(f"Trainable parameters: {sum([tf.keras.backend.count_params(w) for w in model.trainable_weights]):,}")
        
        return model

    @staticmethod
    def _build_class_weights(generator):
        classes = generator.classes
        unique_classes = np.unique(classes)
        weights = compute_class_weight(
            class_weight='balanced',
            classes=unique_classes,
            y=classes
        )
        return {int(class_id): float(weight) for class_id, weight in zip(unique_classes, weights)}

    @staticmethod
    def _freeze_batch_norm_layers(model):
        for layer in model.layers:
            if isinstance(layer, tf.keras.layers.BatchNormalization):
                layer.trainable = False

    def fine_tune_model(self, train_generator, val_generator, class_weights, initial_epoch):
        """Unfreeze the top of the backbone and continue training at a lower LR."""
        print("\nFine-tuning EfficientNet backbone...")

        base_model = self.model.layers[0]
        base_model.trainable = True

        for layer in base_model.layers[:-40]:
            layer.trainable = False
        self._freeze_batch_norm_layers(base_model)

        self.model.compile(
            optimizer=Adam(learning_rate=1e-5),
            loss=tf.keras.losses.CategoricalCrossentropy(label_smoothing=0.05),
            metrics=[
                'accuracy',
                tf.keras.metrics.Precision(name='precision'),
                tf.keras.metrics.Recall(name='recall'),
                tf.keras.metrics.AUC(name='auc')
            ]
        )

        fine_tune_epochs = max(5, min(15, self.epochs // 3))
        fine_tune_callbacks = [
            ModelCheckpoint(
                os.path.join(self.output_dir, 'best_model.h5'),
                monitor='val_loss',
                save_best_only=True,
                mode='min',
                verbose=1
            ),
            ReduceLROnPlateau(
                monitor='val_loss',
                factor=0.2,
                patience=3,
                min_lr=1e-7,
                verbose=1
            ),
            EarlyStopping(
                monitor='val_loss',
                patience=6,
                restore_best_weights=True,
                verbose=1
            )
        ]

        fine_tune_history = self.model.fit(
            train_generator,
            validation_data=val_generator,
            epochs=initial_epoch + fine_tune_epochs,
            initial_epoch=initial_epoch,
            callbacks=fine_tune_callbacks,
            class_weight=class_weights,
            verbose=1
        )
        self.training_histories.append(fine_tune_history.history)
    
    def train_model(self, dataset_path):
        """Train the model"""
        print("\n🚀 Starting Training...")
        
        # Data augmentation for training
        train_datagen = ImageDataGenerator(
            rescale=1./255,
            rotation_range=40,
            width_shift_range=0.2,
            height_shift_range=0.2,
            shear_range=0.2,
            zoom_range=0.2,
            horizontal_flip=True,
            brightness_range=[0.8, 1.2],
            fill_mode='nearest',
            validation_split=0.0
        )
        
        # Validation and test data (only rescaling)
        val_datagen = ImageDataGenerator(rescale=1./255)
        
        # Create generators
        train_generator = train_datagen.flow_from_directory(
            os.path.join(dataset_path, 'train'),
            target_size=self.img_size,
            batch_size=self.batch_size,
            class_mode='categorical',
            shuffle=True
        )
        
        val_generator = val_datagen.flow_from_directory(
            os.path.join(dataset_path, 'val'),
            target_size=self.img_size,
            batch_size=self.batch_size,
            class_mode='categorical',
            shuffle=False
        )
        
        test_generator = val_datagen.flow_from_directory(
            os.path.join(dataset_path, 'test'),
            target_size=self.img_size,
            batch_size=self.batch_size,
            class_mode='categorical',
            shuffle=False
        )
        
        # Update class names based on generator
        self.class_names = list(train_generator.class_indices.keys())
        print(f"\nTraining on classes: {self.class_names}")
        print(f"Training samples: {train_generator.samples}")
        print(f"Validation samples: {val_generator.samples}")
        print(f"Test samples: {test_generator.samples}")
        class_weights = self._build_class_weights(train_generator)
        print(f"Class weights: {class_weights}")
        
        # Callbacks
        callbacks = [
            ModelCheckpoint(
                os.path.join(self.output_dir, 'best_model.h5'),
                monitor='val_loss',
                save_best_only=True,
                mode='min',
                verbose=1
            ),
            ReduceLROnPlateau(
                monitor='val_loss',
                factor=0.2,
                patience=5,
                min_lr=1e-7,
                verbose=1
            ),
            EarlyStopping(
                monitor='val_loss',
                patience=8,
                restore_best_weights=True,
                verbose=1
            ),
            CSVLogger(
                os.path.join(self.output_dir, 'training_log.csv'),
                separator=',',
                append=False
            )
        ]
        
        # Train the model
        print("\nTraining started...")
        self.history = self.model.fit(
            train_generator,
            validation_data=val_generator,
            epochs=self.epochs,
            callbacks=callbacks,
            class_weight=class_weights,
            verbose=1
        )
        self.training_histories.append(self.history.history)

        self.fine_tune_model(
            train_generator=train_generator,
            val_generator=val_generator,
            class_weights=class_weights,
            initial_epoch=len(self.history.history.get('loss', []))
        )

        # Load best model
        best_model_path = os.path.join(self.output_dir, 'best_model.h5')
        if os.path.exists(best_model_path):
            self.model = tf.keras.models.load_model(best_model_path)
            print(f"\nLoaded best model from {best_model_path}")
        
        # Evaluate on test set
        print("\n📊 Evaluating on test set...")
        test_loss, test_acc, test_precision, test_recall, test_auc = self.model.evaluate(test_generator)
        
        # Save final model
        final_model_path = os.path.join(self.output_dir, 'efficientnet_disease_model.h5')
        self.model.save(final_model_path)
        print(f"\nModel saved to: {final_model_path}")
        
        # Save class names
        with open(os.path.join(self.output_dir, 'class_names.json'), 'w') as f:
            json.dump(self.class_names, f)
        
        # Save training metadata
        metadata = {
            'model_path': final_model_path,
            'class_names': self.class_names,
            'image_size': self.img_size,
            'batch_size': self.batch_size,
            'epochs': self.epochs,
            'test_accuracy': float(test_acc),
            'test_precision': float(test_precision),
            'test_recall': float(test_recall),
            'test_auc': float(test_auc),
            'test_loss': float(test_loss),
            'training_samples': train_generator.samples,
            'validation_samples': val_generator.samples,
            'test_samples': test_generator.samples,
            'training_date': datetime.now().isoformat()
        }
        
        with open(os.path.join(self.output_dir, 'training_metadata.json'), 'w') as f:
            json.dump(metadata, f, indent=2)
        
        # Plot training history
        self.plot_training_history()
        
        return {
            'history': self.history.history,
            'test_accuracy': test_acc,
            'test_precision': test_precision,
            'test_recall': test_recall,
            'test_auc': test_auc,
            'test_loss': test_loss,
            'class_names': self.class_names
        }
    
    def plot_training_history(self):
        """Plot training history"""
        if not self.training_histories:
            return

        merged_history = {}
        for history in self.training_histories:
            for key, values in history.items():
                merged_history.setdefault(key, []).extend(values)
        
        fig, axes = plt.subplots(2, 2, figsize=(15, 10))
        
        # Accuracy
        axes[0, 0].plot(merged_history['accuracy'], label='Train')
        axes[0, 0].plot(merged_history['val_accuracy'], label='Validation')
        axes[0, 0].set_title('Model Accuracy')
        axes[0, 0].set_xlabel('Epoch')
        axes[0, 0].set_ylabel('Accuracy')
        axes[0, 0].legend()
        axes[0, 0].grid(True)
        
        # Loss
        axes[0, 1].plot(merged_history['loss'], label='Train')
        axes[0, 1].plot(merged_history['val_loss'], label='Validation')
        axes[0, 1].set_title('Model Loss')
        axes[0, 1].set_xlabel('Epoch')
        axes[0, 1].set_ylabel('Loss')
        axes[0, 1].legend()
        axes[0, 1].grid(True)
        
        # Precision
        if 'precision' in merged_history:
            axes[1, 0].plot(merged_history['precision'], label='Train')
            axes[1, 0].plot(merged_history['val_precision'], label='Validation')
            axes[1, 0].set_title('Model Precision')
            axes[1, 0].set_xlabel('Epoch')
            axes[1, 0].set_ylabel('Precision')
            axes[1, 0].legend()
            axes[1, 0].grid(True)
        
        # Recall
        if 'recall' in merged_history:
            axes[1, 1].plot(merged_history['recall'], label='Train')
            axes[1, 1].plot(merged_history['val_recall'], label='Validation')
            axes[1, 1].set_title('Model Recall')
            axes[1, 1].set_xlabel('Epoch')
            axes[1, 1].set_ylabel('Recall')
            axes[1, 1].legend()
            axes[1, 1].grid(True)
        
        plt.tight_layout()
        plt.savefig(os.path.join(self.output_dir, 'training_history.png'), dpi=300, bbox_inches='tight')
        plt.close()
        
        print(f"Training plots saved to: {os.path.join(self.output_dir, 'training_history.png')}")
    
    def generate_classification_report(self, dataset_path):
        """Generate detailed classification report"""
        print("\n📊 Generating Classification Report...")
        
        val_datagen = ImageDataGenerator(rescale=1./255)
        
        test_generator = val_datagen.flow_from_directory(
            os.path.join(dataset_path, 'test'),
            target_size=self.img_size,
            batch_size=1,
            class_mode='categorical',
            shuffle=False
        )
        
        # Get predictions
        predictions = self.model.predict(test_generator, steps=test_generator.samples)
        predicted_classes = np.argmax(predictions, axis=1)
        true_classes = test_generator.classes
        
        # Generate classification report
        from sklearn.metrics import classification_report, confusion_matrix
        
        report = classification_report(
            true_classes, 
            predicted_classes,
            target_names=self.class_names,
            output_dict=True
        )
        
        # Save report
        with open(os.path.join(self.output_dir, 'classification_report.json'), 'w') as f:
            json.dump(report, f, indent=2)
        
        # Confusion matrix
        cm = confusion_matrix(true_classes, predicted_classes)
        
        # Plot confusion matrix
        import seaborn as sns
        plt.figure(figsize=(12, 10))
        sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
                    xticklabels=self.class_names,
                    yticklabels=self.class_names)
        plt.title('Confusion Matrix')
        plt.xlabel('Predicted')
        plt.ylabel('Actual')
        plt.tight_layout()
        plt.savefig(os.path.join(self.output_dir, 'confusion_matrix.png'), dpi=300, bbox_inches='tight')
        plt.close()
        
        print(f"Classification report saved to: {os.path.join(self.output_dir, 'classification_report.json')}")
        print(f"Confusion matrix saved to: {os.path.join(self.output_dir, 'confusion_matrix.png')}")
        
        # Print report
        print("\nClassification Report:")
        print("-" * 50)
        for class_name in self.class_names:
            if class_name in report:
                print(f"{class_name}:")
                print(f"  Precision: {report[class_name]['precision']:.3f}")
                print(f"  Recall: {report[class_name]['recall']:.3f}")
                print(f"  F1-Score: {report[class_name]['f1-score']:.3f}")
                print(f"  Support: {report[class_name]['support']}")
        
        print("\nOverall Accuracy:", report['accuracy'])
        
        return report

def main():
    parser = argparse.ArgumentParser(description='Train Coconut Disease Detection Model')
    parser.add_argument('--dataset', type=str, default='Coconut Tree Disease dataset',
                        help='Path to the dataset folder')
    parser.add_argument('--output', type=str, default='models_saved',
                        help='Output directory for trained models')
    parser.add_argument('--epochs', type=int, default=50,
                        help='Number of training epochs')
    parser.add_argument('--batch_size', type=int, default=32,
                        help='Batch size for training')
    parser.add_argument('--img_size', type=int, default=224,
                        help='Image size (224x224 by default)')
    parser.add_argument('--no_prepare', action='store_true',
                        help='Skip dataset preparation (use existing organized dataset)')
    parser.add_argument('--no_train', action='store_true',
                        help='Skip training (only prepare dataset)')
    parser.add_argument('--fine_tune', action='store_true',
                        help='Fine-tune the model (unfreeze base layers)')
    
    args = parser.parse_args()
    
    # Initialize trainer
    trainer = CoconutDiseaseTrainer(
        dataset_path=args.dataset,
        output_dir=args.output,
        img_size=(args.img_size, args.img_size),
        batch_size=args.batch_size,
        epochs=args.epochs
    )
    
    # Check if dataset exists
    if not os.path.isdir(trainer.dataset_path):
        print(f"\n❌ Dataset folder '{args.dataset}' not found!")
        print(f"Please ensure your dataset is at the correct path.")
        print(f"Expected structure:")
        print(f"  {args.dataset}/")
        print(f"    ├── Bud Root Dropping/")
        print(f"    ├── Bud Root/")
        print(f"    ├── Gray Leaf Spot/")
        print(f"    ├── Leaf Rot/")
        print(f"    ├── Stem Bleeding/")
        print(f"    └── normal/")
        sys.exit(1)
    
    # Prepare dataset
    organized_path = None
    if not args.no_prepare:
        organized_path = trainer.prepare_dataset()
    
    if args.no_train:
        print("\nTraining skipped (--no_train flag set).")
        return
    
    # Create and train model
    if organized_path is None and os.path.exists('organized_dataset'):
        organized_path = 'organized_dataset'
    elif organized_path is None:
        print("\n❌ No organized dataset found. Please run without --no_prepare first.")
        sys.exit(1)
    
    # Create model
    trainer.create_model()
    
    # Fine-tune if requested
    if args.fine_tune:
        print("\n🔧 Fine-tuning model (unfreezing base layers)...")
        trainer.model.layers[0].trainable = True
        trainer.model.compile(
            optimizer=Adam(learning_rate=0.00001),
            loss='categorical_crossentropy',
            metrics=[
                'accuracy',
                tf.keras.metrics.Precision(name='precision'),
                tf.keras.metrics.Recall(name='recall'),
                tf.keras.metrics.AUC(name='auc')
            ]
        )
    
    # Train model
    results = trainer.train_model(organized_path)
    
    # Generate classification report
    trainer.generate_classification_report(organized_path)
    
    print("\n" + "=" * 70)
    print("✅ TRAINING COMPLETE!")
    print("=" * 70)
    print(f"Model saved to: {args.output}")
    print(f"Test Accuracy: {results['test_accuracy']:.4f}")
    print(f"Test Precision: {results['test_precision']:.4f}")
    print(f"Test Recall: {results['test_recall']:.4f}")
    print(f"Test AUC: {results['test_auc']:.4f}")
    print("=" * 70)
    print("\nYou can now run the application:")
    print("  python app.py")
    print("  Access at: http://localhost:5000")
    print("=" * 70)

if __name__ == "__main__":
    main()
