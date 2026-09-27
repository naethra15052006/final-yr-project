import numpy as np
import cv2
import tensorflow as tf
from tensorflow.keras import backend as K
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import os
try:
    from models.disease_model import DiseaseModel
except ModuleNotFoundError:
    from backend.models.disease_model import DiseaseModel

class GradCAM:
    def __init__(self, model_path=None):
        self.model = None
        if model_path:
            self.model = tf.keras.models.load_model(model_path)
    
    def set_model(self, model):
        self.model = model

    @staticmethod
    def _normalise_class_name(class_name):
        """Compare class labels consistently (e.g. `Leaf Rot` and `Leaf_Rot`)."""
        return str(class_name).replace('_', ' ').strip().lower()
    
    def generate_heatmap(self, image, class_name, output_path, target_size=(224, 224)):
        """Generate Grad-CAM heatmap for the image"""
        if self.model is None:
            # Lazily load the trained classifier if no model was injected.
            disease_model = DiseaseModel()
            self.model = disease_model.model
        
        # Get last convolutional layer
        last_conv_layer = self._find_last_conv_layer()
        
        # Create a model that maps the input image to the activations of the last conv layer
        # and the output predictions
        grad_model = tf.keras.models.Model(
            inputs=self.model.inputs,
            outputs=[self.model.get_layer(last_conv_layer.name).output, self.model.output]
        )
        
        # Prepare image
        if isinstance(image, str):
            img = cv2.imread(image)
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        else:
            img = image.copy()
        
        # Ensure image is in the right format
        if len(img.shape) == 3 and img.shape[2] == 3:
            if img.dtype != np.float32:
                img = img.astype(np.float32)
            if np.max(img) > 1.0:
                img = img / 255.0
        
        # Resize
        img_resized = cv2.resize(img, target_size)
        img_input = np.expand_dims(img_resized, axis=0)
        
        # Get class index
        disease_model = DiseaseModel()
        class_idx = next(
            (
                index for index, name in enumerate(disease_model.class_names)
                if self._normalise_class_name(name) == self._normalise_class_name(class_name)
            ),
            0
        )
        
        try:
            with tf.GradientTape() as tape:
                conv_outputs, predictions = grad_model(img_input)
                loss = predictions[:, class_idx]
            
            # Get gradients
            grads = tape.gradient(loss, conv_outputs)
            
            # Global average pooling
            pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))
            
            # Weight the output by the gradients
            conv_outputs = conv_outputs[0]
            heatmap = tf.reduce_sum(conv_outputs * pooled_grads, axis=-1)
            
            # Normalize heatmap
            heatmap = tf.maximum(heatmap, 0)
            max_activation = tf.reduce_max(heatmap)

            # `divide_no_nan` prevents a zero-activation image from becoming
            # NaN, which OpenCV serialises as an all-black heatmap.
            heatmap = tf.math.divide_no_nan(heatmap, max_activation).numpy()
            heatmap = np.nan_to_num(heatmap, nan=0.0, posinf=1.0, neginf=0.0)

            # If all positive gradients are zero, use the relative activation
            # strength instead of producing a blank image.
            if not np.any(heatmap):
                activation_map = tf.reduce_mean(conv_outputs, axis=-1).numpy()
                activation_map = np.nan_to_num(activation_map)
                minimum, maximum = activation_map.min(), activation_map.max()
                if maximum > minimum:
                    heatmap = (activation_map - minimum) / (maximum - minimum)
            
        except Exception as e:
            print(f"Error generating Grad-CAM: {e}")
            # Create a dummy heatmap
            heatmap = np.ones(target_size[::-1])
        
        # Resize heatmap to original image size
        heatmap_resized = cv2.resize(heatmap, (img.shape[1], img.shape[0]))
        heatmap_resized = np.clip(heatmap_resized, 0.0, 1.0)
        
        # Convert to RGB
        heatmap_colored = cv2.applyColorMap(np.uint8(255 * heatmap_resized), cv2.COLORMAP_TURBO)
        heatmap_colored = cv2.cvtColor(heatmap_colored, cv2.COLOR_BGR2RGB)
        
        # Superimpose heatmap on original image
        img_original = (img * 255).astype(np.uint8)
        superimposed = cv2.addWeighted(img_original, 0.6, heatmap_colored, 0.4, 0)
        
        # Save heatmap
        plt.figure(figsize=(12, 6))
        
        plt.subplot(1, 3, 1)
        plt.imshow(img_original)
        plt.title('Original Image')
        plt.axis('off')
        
        plt.subplot(1, 3, 2)
        plt.imshow(heatmap_resized, cmap='turbo', vmin=0, vmax=1)
        plt.title('Grad-CAM Heatmap')
        plt.axis('off')
        
        plt.subplot(1, 3, 3)
        plt.imshow(superimposed)
        plt.title(f'Detection: {class_name}')
        plt.axis('off')
        
        plt.tight_layout()
        plt.savefig(output_path, dpi=300, bbox_inches='tight', facecolor='white')
        plt.close()
        
        # Also save just the superimposed image
        superimposed_path = output_path.replace('.', '_superimposed.')
        cv2.imwrite(superimposed_path, cv2.cvtColor(superimposed, cv2.COLOR_RGB2BGR))
        
        return output_path
    
    def _find_last_conv_layer(self):
        """Find the last convolutional layer in the model"""
        for layer in reversed(self.model.layers):
            if isinstance(layer, tf.keras.layers.Conv2D):
                return layer
            elif hasattr(layer, 'layer') and isinstance(layer.layer, tf.keras.layers.Conv2D):
                return layer.layer
        return self.model.layers[-5]  # Fallback
    
    def generate_gradcam_with_guided_backprop(self, image, class_name, output_path):
        """Generate Guided Grad-CAM"""
        # This is a more advanced version that combines Grad-CAM with Guided Backpropagation
        heatmap_path = self.generate_heatmap(image, class_name, output_path.replace('.', '_heatmap.'))
        
        # Guided backpropagation would go here
        # For simplicity, we'll use the gradient of the predicted class with respect to the input
        # This is a placeholder for a more sophisticated implementation
        
        return heatmap_path
