// Detect Page JavaScript
let selectedFile = null;

document.addEventListener('DOMContentLoaded', function() {
    setupUploadArea();
    setupFileInput();
});

function setupUploadArea() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    
    uploadArea.addEventListener('click', () => fileInput.click());
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        
        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });
    
    fileInput.addEventListener('change', function() {
        if (this.files.length > 0) {
            handleFile(this.files[0]);
        }
    });
}

function setupFileInput() {
    // Additional file input setup if needed
}

function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please upload an image file.');
        return;
    }
    
    selectedFile = file;
    
    // Show preview
    const reader = new FileReader();
    reader.onload = function(e) {
        const preview = document.getElementById('previewImage');
        preview.src = e.target.result;
        
        document.querySelector('.upload-placeholder').style.display = 'none';
        document.getElementById('uploadPreview').style.display = 'block';
        
        document.getElementById('detectBtn').disabled = false;
    };
    reader.readAsDataURL(file);
}

function removeImage() {
    selectedFile = null;
    document.querySelector('.upload-placeholder').style.display = 'block';
    document.getElementById('uploadPreview').style.display = 'none';
    document.getElementById('previewImage').src = '';
    document.getElementById('fileInput').value = '';
    document.getElementById('detectBtn').disabled = true;
}

function clearUpload() {
    removeImage();
    document.getElementById('resultsContent').style.display = 'none';
    document.querySelector('.results-placeholder').style.display = 'block';
}

async function detectDisease() {
    if (!selectedFile) {
        alert('Please select an image first.');
        return;
    }
    
    const detectBtn = document.getElementById('detectBtn');
    detectBtn.disabled = true;
    detectBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
    
    const formData = new FormData();
    formData.append('image', selectedFile);
    
    try {
        const response = await fetch('/api/detect', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showResults(data);
        } else {
            alert(data.error || 'Detection failed. Please try again.');
        }
    } catch (error) {
        console.error('Detection error:', error);
        alert('An error occurred. Please try again.');
    } finally {
        detectBtn.disabled = false;
        detectBtn.innerHTML = '<i class="fas fa-microscope"></i> Detect Disease';
    }
}

function showResults(data) {
    document.querySelector('.results-placeholder').style.display = 'none';
    document.getElementById('resultsContent').style.display = 'block';
    
    // Set disease name
    document.getElementById('diseaseName').textContent = data.disease_name.replace('_', ' ');
    
    // Set confidence
    const confidence = data.confidence;
    document.getElementById('confidenceScore').textContent = `${confidence}%`;
    document.getElementById('confidenceFill').style.width = `${confidence}%`;
    
    // Set images
    document.getElementById('resultOriginal').src = data.image_url;
    document.getElementById('resultHeatmap').src = data.heatmap_url;
    
    // Set treatment
    if (data.treatment) {
        document.getElementById('treatmentText').textContent = data.treatment.treatment || data.treatment;
    } else {
        document.getElementById('treatmentText').textContent = 'No specific treatment recommendation available. Please consult an agricultural expert.';
    }
    
    // Set date
    const now = new Date();
    document.getElementById('resultDate').textContent = now.toLocaleString();
    
    // Scroll to results
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
}

function goToHistory() {
    window.location.href = '/history';
}

function shareResult() {
    const diseaseName = document.getElementById('diseaseName').textContent;
    const confidence = document.getElementById('confidenceScore').textContent;
    
    if (navigator.share) {
        navigator.share({
            title: 'Coconut Disease Detection Result',
            text: `Detected: ${diseaseName} with ${confidence} confidence using CocoDetect AI`,
            url: window.location.href
        }).catch(() => {});
    } else {
        // Fallback: copy to clipboard
        const text = `CocoDetect AI Result\nDisease: ${diseaseName}\nConfidence: ${confidence}\n\nCheck it out at: ${window.location.href}`;
        navigator.clipboard.writeText(text).then(() => {
            alert('Result copied to clipboard!');
        }).catch(() => {
            alert('Share feature not available. Please copy the URL manually.');
        });
    }
}