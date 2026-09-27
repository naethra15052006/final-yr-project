import cv2
import numpy as np
from PIL import Image
import os

class ImageProcessor:
    def __init__(self, target_size=(224, 224)):
        self.target_size = target_size
    
    def process_image(self, image_path):
        """Process image for model input"""
        try:
            # Read image
            image = cv2.imread(image_path)
            if image is None:
                raise ValueError(f"Could not read image: {image_path}")
            
            # Convert BGR to RGB
            image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Resize
            image = cv2.resize(image, self.target_size)
            
            # Normalize
            image = image.astype(np.float32) / 255.0
            
            return image
        
        except Exception as e:
            raise ValueError(f"Error processing image: {str(e)}")
    
    def preprocess_upload(self, image_file):
        """Preprocess uploaded image file"""
        try:
            # Read image from file-like object
            image = Image.open(image_file)
            image = np.array(image)
            
            # Convert RGBA to RGB if needed
            if len(image.shape) == 3 and image.shape[2] == 4:
                image = cv2.cvtColor(image, cv2.COLOR_RGBA2RGB)
            elif len(image.shape) == 2:  # Grayscale
                image = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
            
            return self.process_image_from_array(image)
        
        except Exception as e:
            raise ValueError(f"Error preprocessing upload: {str(e)}")
    
    def process_image_from_array(self, image_array):
        """Process image from numpy array"""
        try:
            # Resize
            image = cv2.resize(image_array, self.target_size)
            
            # Normalize
            image = image.astype(np.float32) / 255.0
            
            return image
        
        except Exception as e:
            raise ValueError(f"Error processing image array: {str(e)}")
    
    def enhance_contrast(self, image):
        """Enhance image contrast using CLAHE"""
        lab = cv2.cvtColor(image, cv2.COLOR_RGB2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
        l = clahe.apply(l)
        lab = cv2.merge((l, a, b))
        return cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
    
    def remove_noise(self, image):
        """Remove noise using bilateral filter"""
        return cv2.bilateralFilter(image, 9, 75, 75)
    
    def segment_disease_area(self, image, threshold=0.5):
        """Segment disease area in image"""
        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        
        # Apply threshold
        _, binary = cv2.threshold(gray, int(255 * threshold), 255, cv2.THRESH_BINARY)
        
        # Find contours
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        # Create mask
        mask = np.zeros_like(gray)
        cv2.drawContours(mask, contours, -1, 255, -1)
        
        return mask