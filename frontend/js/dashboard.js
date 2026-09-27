// Dashboard JavaScript
let diseaseChart = null;
let trendChart = null;
let currentPage = 1;
let allDetections = [];
let autoRefreshInterval = null;

document.addEventListener('DOMContentLoaded', function() {
    loadDashboardData();
    setupEventListeners();
    
    // Start auto-refresh
    startAutoRefresh();
});

async function loadDashboardData() {
    try {
        const response = await fetch('/api/detections');
        if (response.ok) {
            allDetections = await response.json();
            updateStats(allDetections);
            updateDetectionsList(allDetections);
            updateCharts(allDetections);
            updateWelcomeMessage();
        } else {
            showError('Failed to load dashboard data');
        }
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showError('Failed to load dashboard data');
    }
}

function updateStats(detections) {
    const total = detections.length;
    const healthy = detections.filter(d => d.disease_name === 'Healthy').length;
    const diseased = total - healthy;
    
    animateNumber('totalDetections', total);
    animateNumber('healthyCount', healthy);
    animateNumber('diseaseCount', diseased);
    
    // Calculate trends (compare with last 7 days)
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recentDetections = detections.filter(d => new Date(d.date) >= weekAgo);
    document.getElementById('recentDetections').textContent = recentDetections.length;
    
    // Update trend indicators
    updateTrendIndicators(detections);
}

function animateNumber(elementId, target) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
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

function updateTrendIndicators(detections) {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    
    const recentWeek = detections.filter(d => new Date(d.date) >= weekAgo);
    const previousWeek = detections.filter(d => {
        const date = new Date(d.date);
        return date >= twoWeeksAgo && date < weekAgo;
    });
    
    const trend = recentWeek.length - previousWeek.length;
    const trendElements = document.querySelectorAll('.stat-change');
    
    if (trendElements.length > 0) {
        if (trend > 0) {
            trendElements[0].className = 'stat-change positive';
            trendElements[0].innerHTML = `<i class="fas fa-arrow-up"></i> ${Math.abs(trend)}%`;
        } else if (trend < 0) {
            trendElements[0].className = 'stat-change negative';
            trendElements[0].innerHTML = `<i class="fas fa-arrow-down"></i> ${Math.abs(trend)}%`;
        } else {
            trendElements[0].className = 'stat-change';
            trendElements[0].innerHTML = `<i class="fas fa-minus"></i> 0%`;
        }
    }
}

function updateDetectionsList(detections) {
    const list = document.getElementById('detectionsList');
    const recent = detections.slice(0, 5);
    
    if (recent.length === 0) {
        list.innerHTML = `
            <div class="detection-item empty-state-mini" style="justify-content: center; padding: 30px;">
                <div style="text-align: center;">
                    <i class="fas fa-camera" style="font-size: 2rem; color: var(--gray); display: block; margin-bottom: 10px;"></i>
                    <p style="color: var(--gray);">No detections yet. Start by detecting a disease!</p>
                    <a href="/detect" class="btn-primary" style="display: inline-block; margin-top: 10px; padding: 8px 20px; font-size: 0.9rem;">
                        <i class="fas fa-camera"></i> Detect Now
                    </a>
                </div>
            </div>
        `;
        return;
    }
    
    list.innerHTML = recent.map((d, index) => `
        <div class="detection-item" style="animation: fadeIn 0.3s ease ${index * 0.1}s both;">
            <div class="detection-image">
                <img src="${d.image_url}" alt="${d.disease_name}" loading="lazy">
            </div>
            <div class="detection-info">
                <h4>${d.disease_name.replace('_', ' ')}</h4>
                <p><i class="far fa-calendar-alt"></i> ${formatDate(d.date)}</p>
            </div>
            <div class="detection-confidence ${getConfidenceClass(d.confidence)}">
                ${d.confidence}%
            </div>
            <button class="detection-view-btn" onclick="viewDetectionDetail(${d.id})" title="View Details">
                <i class="fas fa-chevron-right"></i>
            </button>
        </div>
    `).join('');
}

function viewDetectionDetail(id) {
    const detection = allDetections.find(d => d.id === id);
    if (!detection) return;
    
    // Show in a modal or navigate to history
    window.location.href = `/history#detection-${id}`;
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
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function getConfidenceClass(confidence) {
    if (confidence >= 85) return 'high';
    if (confidence >= 70) return 'medium';
    return 'low';
}

function updateCharts(detections) {
    updateDiseaseChart(detections);
    updateTrendChart(detections);
}

function updateDiseaseChart(detections) {
    const diseaseCounts = {};
    detections.forEach(d => {
        diseaseCounts[d.disease_name] = (diseaseCounts[d.disease_name] || 0) + 1;
    });
    
    const labels = Object.keys(diseaseCounts).map(name => name.replace('_', ' '));
    const data = Object.values(diseaseCounts);
    const colors = ['#2ecc71', '#3498db', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c'];
    
    const ctx = document.getElementById('diseaseChart').getContext('2d');
    
    if (diseaseChart) {
        diseaseChart.destroy();
    }
    
    const isDarkTheme = document.body.classList.contains('dark-theme');
    const chartTextColor = isDarkTheme ? '#e2e8f0' : '#2c3e50';

    diseaseChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 3,
                borderColor: isDarkTheme ? '#2d2d44' : '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        color: chartTextColor
                    }
                }
            },
            cutout: '65%'
        }
    });
}

function updateTrendChart(detections) {
    const dates = {};
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        dates[dateStr] = 0;
    }

    detections.forEach(detection => {
        const dateStr = detection.date.split(' ')[0];
        if (dates.hasOwnProperty(dateStr)) {
            dates[dateStr]++;
        }
    });

    const labels = Object.keys(dates);
    const data = Object.values(dates);
    
    const ctx = document.getElementById('trendChart').getContext('2d');
    
    if (trendChart) {
        trendChart.destroy();
    }
    
    const isDarkTheme = document.body.classList.contains('dark-theme');
    const chartTextColor = isDarkTheme ? '#e2e8f0' : '#2c3e50';
    const gridColor = isDarkTheme ? 'rgba(226, 232, 240, 0.15)' : 'rgba(44, 62, 80, 0.1)';

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.map(d => {
                const date = new Date(d);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }),
            datasets: [{
                label: 'Detections',
                data: data,
                borderColor: '#2ecc71',
                backgroundColor: 'rgba(46, 204, 113, 0.1)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#2ecc71',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1,
                        color: chartTextColor
                    },
                    grid: { color: gridColor }
                },
                x: {
                    ticks: { color: chartTextColor },
                    grid: { color: gridColor }
                }
            }
        }
    });
}

function updateWelcomeMessage() {
    const userData = JSON.parse(localStorage.getItem('user') || '{}');
    const username = userData.username || 'User';
    
    const welcomeElement = document.querySelector('.welcome-message');
    if (welcomeElement) {
        const hour = new Date().getHours();
        let greeting = 'Good morning';
        if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
        else if (hour >= 17) greeting = 'Good evening';
        
        welcomeElement.textContent = `${greeting}, ${username}!`;
    }
}

function setupEventListeners() {
    // Search functionality
    const searchInput = document.querySelector('.header-search input');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(function() {
            const query = this.value.toLowerCase();
            const filtered = allDetections.filter(d => 
                d.disease_name.toLowerCase().includes(query) ||
                d.date.includes(query)
            );
            updateDetectionsList(filtered);
        }, 300));
    }
    
    // Notification button
    const notificationBtn = document.querySelector('.notification-btn');
    if (notificationBtn) {
        notificationBtn.addEventListener('click', function() {
            showNotificationPanel();
        });
    }
    
    // Theme toggle
    const themeToggle = document.querySelector('.theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
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

function toggleTheme() {
    document.body.classList.toggle('dark-theme');
    const icon = document.querySelector('.theme-toggle i');
    if (document.body.classList.contains('dark-theme')) {
        icon.className = 'fas fa-sun';
        localStorage.setItem('theme', 'dark');
    } else {
        icon.className = 'fas fa-moon';
        localStorage.setItem('theme', 'light');
    }

    updateCharts(allDetections);
}

function showNotificationPanel() {
    // Simple notification system
    const notifications = [
        { icon: 'fa-leaf', message: 'New disease detection available', time: '2 min ago', type: 'info' },
        { icon: 'fa-check-circle', message: 'Model updated to v1.1', time: '1 hour ago', type: 'success' },
        { icon: 'fa-exclamation-triangle', message: 'High disease activity detected in your area', time: '3 hours ago', type: 'warning' }
    ];
    
    const panel = document.createElement('div');
    panel.className = 'notification-panel';
    panel.innerHTML = `
        <div class="notification-header">
            <h3>Notifications</h3>
            <button class="notification-close" onclick="this.parentElement.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="notification-list">
            ${notifications.map(n => `
                <div class="notification-item notification-${n.type}">
                    <i class="fas ${n.icon}"></i>
                    <div class="notification-content">
                        <p>${n.message}</p>
                        <span class="notification-time">${n.time}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    
    document.body.appendChild(panel);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
        if (panel.parentElement) {
            panel.remove();
        }
    }, 10000);
}

function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    autoRefreshInterval = setInterval(() => {
        loadDashboardData();
    }, 30000); // Refresh every 30 seconds
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

// Error notification
function showError(message) {
    const container = document.createElement('div');
    container.className = 'toast-container';
    container.innerHTML = `
        <div class="toast toast-error">
            <div class="toast-icon"><i class="fas fa-exclamation-circle"></i></div>
            <div class="toast-message">${message}</div>
            <button class="toast-close" onclick="this.parentElement.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    document.body.appendChild(container);
    
    setTimeout(() => {
        container.remove();
    }, 5000);
}

// Add styles for notifications
const dashboardStyles = `
.notification-panel {
    position: fixed;
    top: 80px;
    right: 20px;
    width: 350px;
    max-height: 400px;
    background: var(--white);
    border-radius: var(--radius);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    z-index: 9999;
    overflow: hidden;
    animation: slideInRight 0.3s ease;
}

.notification-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px 20px;
    border-bottom: 1px solid #e2e8f0;
}

.notification-header h3 {
    font-size: 1rem;
    margin: 0;
}

.notification-close {
    background: none;
    border: none;
    color: var(--gray);
    cursor: pointer;
    padding: 4px;
}

.notification-list {
    max-height: 350px;
    overflow-y: auto;
    padding: 10px 0;
}

.notification-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 20px;
    border-bottom: 1px solid #f1f5f9;
    transition: var(--transition);
}

.notification-item:hover {
    background: #f8fafc;
}

.notification-item i {
    font-size: 1.1rem;
    margin-top: 2px;
}

.notification-item.notification-info i {
    color: #3498db;
}

.notification-item.notification-success i {
    color: #2ecc71;
}

.notification-item.notification-warning i {
    color: #f39c12;
}

.notification-content {
    flex: 1;
}

.notification-content p {
    margin: 0;
    font-size: 0.9rem;
}

.notification-time {
    font-size: 0.75rem;
    color: var(--gray);
}

.detection-view-btn {
    background: none;
    border: none;
    color: var(--gray);
    cursor: pointer;
    padding: 4px 8px;
    transition: var(--transition);
}

.detection-view-btn:hover {
    color: var(--primary);
    transform: translateX(3px);
}

.dark-theme .notification-panel {
    background: #2d2d44;
}

.dark-theme .notification-header {
    border-bottom-color: #3d3d5c;
}

.dark-theme .notification-item {
    border-bottom-color: #3d3d5c;
}

.dark-theme .notification-item:hover {
    background: #3d3d5c;
}

.welcome-message {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--dark);
}

.dark-theme .welcome-message {
    color: #e2e8f0;
}
`;

if (!document.getElementById('dashboardStyles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'dashboardStyles';
    styleEl.textContent = dashboardStyles;
    document.head.appendChild(styleEl);
}

// Load saved theme preference
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
    const icon = document.querySelector('.theme-toggle i');
    if (icon) {
        icon.className = 'fas fa-sun';
    }
}
