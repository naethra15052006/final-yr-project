// History Page JavaScript
let allDetections = [];
let currentPage = 1;
const itemsPerPage = 10;
let currentFilter = 'all';
let dateFrom = '';
let dateTo = '';
let searchQuery = '';

function treatmentToText(treatment) {
    if (!treatment) return '';
    if (typeof treatment === 'string') return treatment;
    if (typeof treatment === 'object') {
        return Object.values(treatment).filter(Boolean).join(' ');
    }
    return String(treatment);
}

document.addEventListener('DOMContentLoaded', function() {
    loadHistory();
    setupEventListeners();
});

async function loadHistory(page = 1) {
    currentPage = page;
    
    try {
        const response = await fetch('/api/detections');
        if (response.ok) {
            allDetections = await response.json();
            updateHistoryStats(allDetections);
            applyFiltersAndRender();
        } else {
            showError('Failed to load history. Please try again.');
        }
    } catch (error) {
        console.error('Error loading history:', error);
        showError('An error occurred while loading your history.');
    }
}

function updateHistoryStats(detections) {
    const total = detections.length;
    const healthy = detections.filter(d => d.disease_name === 'Healthy').length;
    const diseased = total - healthy;
    const avgConfidence = detections.length > 0 
        ? detections.reduce((sum, d) => sum + d.confidence, 0) / detections.length 
        : 0;
    
    // Animate numbers
    animateNumber('totalHistory', total);
    animateNumber('healthyHistory', healthy);
    animateNumber('diseaseHistory', diseased);
    document.getElementById('avgConfidence').textContent = `${Math.round(avgConfidence)}%`;
}

function animateNumber(elementId, target) {
    const element = document.getElementById(elementId);
    let current = 0;
    const increment = Math.ceil(target / 30);
    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            current = target;
            clearInterval(timer);
        }
        element.textContent = current;
    }, 20);
}

function applyFiltersAndRender() {
    let filtered = [...allDetections];
    
    // Apply disease filter
    if (currentFilter !== 'all') {
        filtered = filtered.filter(d => d.disease_name === currentFilter);
    }
    
    // Apply date filters
    if (dateFrom) {
        filtered = filtered.filter(d => d.date.split(' ')[0] >= dateFrom);
    }
    if (dateTo) {
        filtered = filtered.filter(d => d.date.split(' ')[0] <= dateTo);
    }
    
    // Apply search
    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(d => 
            d.disease_name.toLowerCase().includes(query) ||
            d.date.includes(query) ||
            treatmentToText(d.treatment).toLowerCase().includes(query)
        );
    }
    
    renderHistory(filtered);
}

function renderHistory(detections) {
    const container = document.getElementById('historyList');
    
    // Pagination
    const totalPages = Math.ceil(detections.length / itemsPerPage);
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageItems = detections.slice(start, end);
    
    if (pageItems.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <h3>No Detections Found</h3>
                <p>Start detecting diseases to build your history.</p>
                <a href="/detect" class="btn-primary" style="display: inline-block; margin-top: 15px;">
                    <i class="fas fa-camera"></i> Detect Now
                </a>
            </div>
        `;
        updatePagination(0, 0);
        return;
    }
    
    container.innerHTML = pageItems.map((d, index) => `
        <div class="history-item" data-id="${d.id}" style="animation: fadeIn 0.3s ease ${index * 0.05}s both;">
            <div class="history-item-image">
                <img src="${d.image_url}" alt="${d.disease_name}" loading="lazy">
                <div class="history-item-status ${d.disease_name === 'Healthy' ? 'healthy' : 'diseased'}">
                    ${d.disease_name === 'Healthy' ? '✅ Healthy' : '⚠️ ' + d.disease_name.replace('_', ' ')}
                </div>
            </div>
            <div class="history-item-info">
                <h4>${d.disease_name.replace('_', ' ')}</h4>
                <div class="history-item-details">
                    <span class="confidence-badge ${getConfidenceClass(d.confidence)}">
                        ${d.confidence}% Confidence
                    </span>
                    <span class="date-badge">
                        <i class="far fa-calendar-alt"></i> ${formatDate(d.date)}
                    </span>
                </div>
                ${d.treatment ? `
                    <div class="treatment-preview">
                        <i class="fas fa-heartbeat"></i> ${treatmentToText(d.treatment).substring(0, 100)}${treatmentToText(d.treatment).length > 100 ? '...' : ''}
                    </div>
                ` : ''}
            </div>
            <div class="history-item-actions">
                <button class="btn-view" onclick="viewDetail(${d.id})" title="View Details">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn-download" onclick="downloadResult(${d.id})" title="Download Report">
                    <i class="fas fa-download"></i>
                </button>
                <button class="btn-delete" onclick="deleteDetection(${d.id})" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
    
    updatePagination(currentPage, totalPages);
}

function updatePagination(current, total) {
    document.getElementById('pageInfo').textContent = `Page ${current} of ${total || 1}`;
    document.getElementById('prevPage').disabled = current <= 1;
    document.getElementById('nextPage').disabled = current >= total;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;
    
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getConfidenceClass(confidence) {
    if (confidence >= 85) return 'high';
    if (confidence >= 70) return 'medium';
    return 'low';
}

function setupEventListeners() {
    // Search
    const searchInput = document.getElementById('searchHistory');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function() {
            searchQuery = this.value.trim();
            currentPage = 1;
            applyFiltersAndRender();
        }, 300));
    }
    
    // Filter changes
    document.getElementById('diseaseFilter').addEventListener('change', function() {
        currentFilter = this.value;
        currentPage = 1;
        applyFiltersAndRender();
    });
    
    document.getElementById('dateFrom').addEventListener('change', function() {
        dateFrom = this.value;
        currentPage = 1;
        applyFiltersAndRender();
    });
    
    document.getElementById('dateTo').addEventListener('change', function() {
        dateTo = this.value;
        currentPage = 1;
        applyFiltersAndRender();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeModal();
        }
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            document.getElementById('searchHistory').focus();
        }
    });
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function toggleFilter() {
    const filterBar = document.getElementById('filterBar');
    const isVisible = filterBar.style.display === 'flex';
    filterBar.style.display = isVisible ? 'none' : 'flex';
    
    if (!isVisible) {
        filterBar.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function applyFilter() {
    currentPage = 1;
    applyFiltersAndRender();
}

function clearFilter() {
    document.getElementById('diseaseFilter').value = 'all';
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    document.getElementById('searchHistory').value = '';
    currentFilter = 'all';
    dateFrom = '';
    dateTo = '';
    searchQuery = '';
    currentPage = 1;
    applyFiltersAndRender();
}

function changePage(delta) {
    const totalPages = Math.ceil(allDetections.length / itemsPerPage);
    const newPage = currentPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        loadHistory(newPage);
    }
}

async function viewDetail(id) {
    const detection = allDetections.find(d => d.id === id);
    if (!detection) {
        showError('Detection not found');
        return;
    }
    
    const modal = document.getElementById('detailModal');
    const body = document.getElementById('modalBody');
    
    body.innerHTML = `
        <div class="detail-grid">
            <div class="detail-images">
                <div class="detail-image">
                    <h4><i class="fas fa-image"></i> Original Image</h4>
                    <img src="${detection.image_url}" alt="Original Image" loading="lazy">
                </div>
                <div class="detail-image">
                    <h4><i class="fas fa-fire"></i> Grad-CAM Heatmap</h4>
                    <img src="${detection.heatmap_url}" alt="Grad-CAM Heatmap" loading="lazy">
                </div>
            </div>
            <div class="detail-info">
                <div class="detail-info-item">
                    <label>Disease</label>
                    <h3>${detection.disease_name.replace('_', ' ')}</h3>
                </div>
                <div class="detail-info-item">
                    <label>Confidence</label>
                    <div class="confidence-display">
                        <span class="confidence-value">${detection.confidence}%</span>
                        <div class="confidence-bar-large">
                            <div class="confidence-fill-large" style="width: ${detection.confidence}%"></div>
                        </div>
                    </div>
                </div>
                <div class="detail-info-item">
                    <label>Date & Time</label>
                    <p><i class="far fa-clock"></i> ${detection.date}</p>
                </div>
                ${detection.treatment ? `
                    <div class="detail-info-item treatment-section">
                        <label><i class="fas fa-heartbeat"></i> Treatment Recommendation</label>
                        <div class="treatment-content">
                            ${typeof detection.treatment === 'string' ? 
                                `<p>${detection.treatment}</p>` :
                                `<p>${detection.treatment.treatment || 'No specific treatment available'}</p>
                                ${detection.treatment.prevention ? `<p><strong>Prevention:</strong> ${detection.treatment.prevention}</p>` : ''}
                                ${detection.treatment.fertilizer ? `<p><strong>Fertilizer:</strong> ${detection.treatment.fertilizer}</p>` : ''}`
                            }
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('detailModal').classList.remove('active');
    document.body.style.overflow = 'auto';
}

async function deleteDetection(id) {
    if (!confirm('Are you sure you want to delete this detection? This action cannot be undone.')) return;
    
    try {
        const response = await fetch(`/api/detection/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showSuccess('Detection deleted successfully!');
            loadHistory(currentPage);
        } else {
            const data = await response.json();
            showError(data.error || 'Failed to delete detection.');
        }
    } catch (error) {
        console.error('Error deleting detection:', error);
        showError('An error occurred. Please try again.');
    }
}

async function downloadResult(id) {
    const detection = allDetections.find(d => d.id === id);
    if (!detection) {
        showError('Detection not found');
        return;
    }
    
    try {
        // Create a report
        const report = generateReport(detection);
        
        // Download as text file
        const blob = new Blob([report], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `detection_report_${detection.id}_${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        
        showSuccess('Report downloaded successfully!');
    } catch (error) {
        console.error('Error downloading report:', error);
        showError('Failed to download report.');
    }
}

function generateReport(detection) {
    const date = new Date(detection.date);
    return `
===========================================
    COCODETECT AI - DETECTION REPORT
===========================================

Report ID: #${detection.id}
Date: ${date.toLocaleString()}
Disease: ${detection.disease_name.replace('_', ' ')}
Confidence: ${detection.confidence}%

Image URL: ${detection.image_url}
Heatmap URL: ${detection.heatmap_url}

${detection.treatment ? `
TREATMENT RECOMMENDATION:
-------------------------
${typeof detection.treatment === 'string' ? detection.treatment : JSON.stringify(detection.treatment, null, 2)}
` : ''}

===========================================
    Powered by EfficientNet & Grad-CAM
===========================================
    `;
}

function exportHistory() {
    let filtered = [...allDetections];
    
    if (currentFilter !== 'all') {
        filtered = filtered.filter(d => d.disease_name === currentFilter);
    }
    if (dateFrom) {
        filtered = filtered.filter(d => d.date.split(' ')[0] >= dateFrom);
    }
    if (dateTo) {
        filtered = filtered.filter(d => d.date.split(' ')[0] <= dateTo);
    }
    
    if (filtered.length === 0) {
        showError('No detections to export.');
        return;
    }
    
    // Create CSV
    const headers = ['ID', 'Disease', 'Confidence (%)', 'Date', 'Treatment'];
    const rows = filtered.map(d => [
        d.id,
        d.disease_name.replace('_', ' '),
        d.confidence,
        d.date,
        treatmentToText(d.treatment).replace(/,/g, ';')
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    
    // Download
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `detection_history_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    showSuccess('History exported successfully!');
}

// Toast notifications
function showError(message) {
    showToast(message, 'error');
}

function showSuccess(message) {
    showToast(message, 'success');
}

function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast-container');
    if (existing) existing.remove();
    
    const container = document.createElement('div');
    container.className = 'toast-container';
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas ${type === 'error' ? 'fa-exclamation-circle' : type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}"></i>
        </div>
        <div class="toast-message">${message}</div>
        <button class="toast-close" onclick="this.parentElement.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    container.appendChild(toast);
    document.body.appendChild(container);
    
    setTimeout(() => {
        container.remove();
    }, 5000);
}

// Add toast styles dynamically
const toastStyles = `
.toast-container {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
    animation: slideInRight 0.3s ease;
}

.toast {
    background: var(--white);
    padding: 16px 20px;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 300px;
    max-width: 500px;
    border-left: 4px solid var(--primary);
}

.toast-error {
    border-left-color: #dc2626;
}

.toast-success {
    border-left-color: #16a34a;
}

.toast-icon {
    font-size: 1.2rem;
}

.toast-error .toast-icon {
    color: #dc2626;
}

.toast-success .toast-icon {
    color: #16a34a;
}

.toast-message {
    flex: 1;
    font-size: 0.95rem;
}

.toast-close {
    background: none;
    border: none;
    color: var(--gray);
    cursor: pointer;
    padding: 4px;
}

.toast-close:hover {
    color: var(--dark);
}

@keyframes slideInRight {
    from {
        transform: translateX(100%);
        opacity: 0;
    }
    to {
        transform: translateX(0);
        opacity: 1;
    }
}

.empty-state {
    text-align: center;
    padding: 60px 20px;
}

.empty-state i {
    font-size: 4rem;
    color: #d1d5db;
    margin-bottom: 20px;
}

.empty-state h3 {
    font-size: 1.5rem;
    margin-bottom: 10px;
}

.empty-state p {
    color: var(--gray);
}

.detail-grid {
    display: grid;
    gap: 25px;
}

.detail-images {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
}

.detail-image h4 {
    margin-bottom: 10px;
    color: var(--gray);
    font-size: 0.9rem;
}

.detail-image img {
    width: 100%;
    border-radius: 10px;
    box-shadow: var(--shadow);
}

.detail-info {
    display: grid;
    gap: 20px;
}

.detail-info-item label {
    display: block;
    font-weight: 600;
    color: var(--gray);
    font-size: 0.85rem;
    margin-bottom: 5px;
}

.detail-info-item h3 {
    font-size: 1.3rem;
}

.confidence-display {
    margin-top: 5px;
}

.confidence-value {
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--primary-dark);
}

.confidence-bar-large {
    height: 10px;
    background: #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
    margin-top: 5px;
}

.confidence-fill-large {
    height: 100%;
    background: linear-gradient(90deg, var(--primary), var(--primary-dark));
    border-radius: 10px;
    transition: width 1s ease;
}

.treatment-section {
    background: #f8fafc;
    padding: 15px;
    border-radius: 10px;
}

.treatment-content {
    margin-top: 5px;
}

.treatment-content p {
    margin: 5px 0;
    line-height: 1.6;
}

.history-item-status {
    position: absolute;
    top: 10px;
    left: 10px;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 600;
    background: rgba(0, 0, 0, 0.7);
    color: white;
}

.history-item-status.healthy {
    background: rgba(22, 163, 74, 0.9);
}

.history-item-status.diseased {
    background: rgba(220, 38, 38, 0.9);
}

.history-item-image {
    position: relative;
}

.history-item-details {
    display: flex;
    gap: 15px;
    margin-top: 5px;
    flex-wrap: wrap;
}

.confidence-badge {
    padding: 2px 12px;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 600;
}

.confidence-badge.high {
    background: #dcfce7;
    color: #16a34a;
}

.confidence-badge.medium {
    background: #fef3c7;
    color: #d97706;
}

.confidence-badge.low {
    background: #fee2e2;
    color: #dc2626;
}

.date-badge {
    font-size: 0.8rem;
    color: var(--gray);
}

.treatment-preview {
    margin-top: 8px;
    font-size: 0.85rem;
    color: var(--gray);
    padding: 8px 12px;
    background: #f8fafc;
    border-radius: 8px;
}

.treatment-preview i {
    color: var(--primary);
    margin-right: 5px;
}

@media (max-width: 768px) {
    .detail-images {
        grid-template-columns: 1fr;
    }
    
    .history-item-details {
        flex-direction: column;
        gap: 5px;
    }
    
    .history-item-actions {
        margin-top: 10px;
        width: 100%;
        justify-content: center;
    }
}
`;

// Add toast styles if not already present
if (!document.getElementById('toastStyles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'toastStyles';
    styleEl.textContent = toastStyles;
    document.head.appendChild(styleEl);
}

// Modal close on outside click
document.getElementById('detailModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeModal();
    }
});

// Keyboard shortcuts for pagination
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        changePage(-1);
    }
    if (e.ctrlKey && e.key === 'ArrowRight') {
        e.preventDefault();
        changePage(1);
    }
});
