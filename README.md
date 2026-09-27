# CocoDetect AI - Coconut Disease Detection System

An AI-powered coconut disease detection system using EfficientNet and Grad-CAM for accurate disease identification and visual explanations.

## 🌴 Features

- **AI-Powered Detection**: Uses EfficientNet deep learning model for accurate disease classification
- **Visual Explanations**: Grad-CAM heatmaps highlight infected regions for transparent AI decisions
- **Real-time Analysis**: Instant disease detection with confidence scores
- **Treatment Recommendations**: Get immediate treatment and prevention tips
- **User Management**: Registration, login, and history tracking
- **Admin Panel**: Manage users, view statistics, and monitor system performance
- **Responsive Design**: Works on desktop, tablet, and mobile devices

## 🏗️ Architecture

### Technologies Used
- **Backend**: Flask, SQLAlchemy, TensorFlow, Keras
- **Frontend**: HTML5, CSS3, JavaScript, Chart.js
- **AI Model**: EfficientNetB0 with transfer learning
- **Visualization**: Grad-CAM for heatmap generation
- **Database**: SQLite

### Supported Diseases
- Bud Rot (*Phytophthora palmivora*)
- Leaf Blight (*Bipolaris incurvata*)
- Stem Bleeding (*Ceratocystis paradoxa*)
- Root Wilt (*Phytoplasma*)
- Healthy (No disease detected)

## 📋 Prerequisites

- Python 3.8+
- TensorFlow 2.13+
- 4GB+ RAM (8GB recommended)
- GPU (optional, for faster training)

## 🚀 Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/coconut-disease-detection.git
cd coconut-disease-detection