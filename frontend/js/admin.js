// Admin Panel JavaScript - Enhanced with all features

let currentAdminTab = 'dashboard';
let usersPage = 1;
let detectionsPage = 1;
let logsPage = 1;
let currentReportId = null;
let allUsers = [];
let allDetections = [];
let allDiseases = [];
let allLogs = [];
let currentEditingUserId = null;
let currentEditingDetectionId = null;
let currentEditingDiseaseId = null;
let currentReportPreview = null;
let reportViewerMode = false;

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', function() {
    // Check admin access
    const userData = JSON.parse(localStorage.getItem('user') || '{}');
    if (!userData.is_admin) {
        window.location.href = '/dashboard';
        return;
    }
    
    document.getElementById('usernameDisplay').textContent = userData.username || 'Admin';
    
    // Load all data
    loadAdminStats();
    loadUsers();
    loadDiseases();
    loadDetections();
    loadLogs();
    loadReports();
    loadCharts();
    loadNotifications();
    setInterval(loadNotifications, 30000);
    
    // Setup event listeners
    setupEventListeners();
});

// ==================== STATISTICS ====================

async function loadAdminStats() {
    try {
        const response = await fetch('/api/admin/stats');
        if (response.ok) {
            const stats = await response.json();
            animateNumber('totalUsers', stats.total_users);
            animateNumber('totalDetections', stats.total_detections);
            animateNumber('activeDetections', stats.active_users || 0);
            
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
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

// ==================== CHARTS ====================

function loadCharts() {
    loadDiseaseDistributionChart();
    loadDetectionTrendChart();
    loadUserActivityChart();
}

async function loadDiseaseDistributionChart() {
    try {
        const response = await fetch('/api/admin/stats');
        if (response.ok) {
            const stats = await response.json();
            const data = stats.disease_distribution || [];
            
            const options = {
                series: data.map(d => d.count),
                labels: data.map(d => d.name.replace('_', ' ')),
                chart: {
                    type: 'donut',
                    height: 300
                },
                colors: ['#2ecc71', '#3498db', '#e74c3c', '#f39c12', '#9b59b6'],
                legend: {
                    position: 'bottom'
                },
                responsive: [{
                    breakpoint: 480,
                    options: {
                        chart: {
                            width: 300
                        },
                        legend: {
                            position: 'bottom'
                        }
                    }
                }]
            };
            
            const chart = new ApexCharts(document.getElementById('diseaseDistributionChart'), options);
            chart.render();
        }
    } catch (error) {
        console.error('Error loading disease distribution chart:', error);
    }
}

async function loadDetectionTrendChart() {
    try {
        const response = await fetch('/api/admin/stats');
        if (response.ok) {
            const stats = await response.json();
            const data = stats.daily_stats || [];
            
            const options = {
                series: [{
                    name: 'Detections',
                    data: data.map(d => d.count)
                }],
                chart: {
                    type: 'area',
                    height: 300,
                    toolbar: {
                        show: false
                    }
                },
                xaxis: {
                    categories: data.map(d => new Date(d.date).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric' 
                    })),
                },
                colors: ['#2ecc71'],
                fill: {
                    type: 'gradient',
                    gradient: {
                        shadeIntensity: 1,
                        opacityFrom: 0.7,
                        opacityTo: 0.3,
                        stops: [0, 100]
                    }
                },
                stroke: {
                    curve: 'smooth',
                    width: 3
                },
                dataLabels: {
                    enabled: false
                }
            };
            
            const chart = new ApexCharts(document.getElementById('detectionTrendChart'), options);
            chart.render();
        }
    } catch (error) {
        console.error('Error loading detection trend chart:', error);
    }
}

async function loadUserActivityChart() {
    try {
        const response = await fetch('/api/admin/stats');
        if (response.ok) {
            const stats = await response.json();
            const data = stats.disease_distribution || [];
            
            const options = {
                series: [{
                    name: 'Detections per Disease',
                    data: data.map(d => d.count)
                }],
                chart: {
                    type: 'bar',
                    height: 300,
                    toolbar: {
                        show: false
                    }
                },
                xaxis: {
                    categories: data.map(d => d.name.replace('_', ' ')),
                },
                colors: ['#3498db'],
                plotOptions: {
                    bar: {
                        borderRadius: 10,
                        dataLabels: {
                            position: 'top'
                        }
                    }
                },
                dataLabels: {
                    enabled: true,
                    offsetY: -20,
                    style: {
                        fontSize: '12px',
                        colors: ["#304758"]
                    }
                }
            };
            
            const chart = new ApexCharts(document.getElementById('userActivityChart'), options);
            chart.render();
        }
    } catch (error) {
        console.error('Error loading user activity chart:', error);
    }
}

// ==================== TAB MANAGEMENT ====================

function switchTab(tab) {
    currentAdminTab = tab;
    
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tab) {
            btn.classList.add('active');
        }
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        if (content.id === `${tab}Tab`) {
            content.classList.add('active');
        }
    });
    
    // Refresh data based on tab
    if (tab === 'users') loadUsers();
    else if (tab === 'diseases') loadDiseases();
    else if (tab === 'detections') loadDetections();
    else if (tab === 'reports') loadReports();
    else if (tab === 'logs') loadLogs();
}

// ==================== USER MANAGEMENT ====================

async function loadUsers(page = 1) {
    usersPage = page;
    const search = document.getElementById('userSearch')?.value || '';
    
    try {
        const response = await fetch(`/api/admin/users?page=${page}&search=${encodeURIComponent(search)}`);
        if (response.ok) {
            const data = await response.json();
            allUsers = data.users;
            renderUsers(data.users);
            updateUsersPagination(data);
        }
    } catch (error) {
        console.error('Error loading users:', error);
        showError('Failed to load users');
    }
}

function renderUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    
    if (!users || users.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 40px; color: var(--gray);">
                    <i class="fas fa-users" style="font-size: 2rem; display: block; margin-bottom: 10px;"></i>
                    No users found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = users.map((u, index) => `
        <tr style="animation: fadeIn 0.3s ease ${index * 0.05}s both;">
            <td><input type="checkbox" class="user-checkbox" value="${u.id}" onchange="updateBulkActions()"></td>
            <td><span class="user-id">#${u.id}</span></td>
            <td>
                <div class="user-cell">
                    <img src="https://ui-avatars.com/api/?name=${u.username}&background=2ecc71&color=fff&size=32" alt="${u.username}" class="user-avatar">
                    <span class="user-name">${u.username}</span>
                </div>
            </td>
            <td>${u.email}</td>
            <td>
                <span class="role-badge ${u.is_admin ? 'admin' : 'user'}">
                    <i class="fas ${u.is_admin ? 'fa-shield-alt' : 'fa-user'}"></i>
                    ${u.is_admin ? 'Admin' : 'User'}
                </span>
            </td>
            <td>
                <span class="status-badge ${u.is_active ? 'active' : 'inactive'}">
                    ${u.is_active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td><span class="detection-count">${u.detection_count || 0}</span></td>
            <td>${formatDate(u.created_at)}</td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn view" onclick="viewUser(${u.id})" title="View User">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="action-btn edit" onclick="editUser(${u.id})" title="Edit User">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${!u.is_admin ? `
                        <button class="action-btn toggle" onclick="toggleAdmin(${u.id})" title="Make Admin">
                            <i class="fas fa-user-shield"></i>
                        </button>
                    ` : ''}
                    <button class="action-btn delete" onclick="deleteUser(${u.id})" title="Delete User">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function updateUsersPagination(data) {
    document.getElementById('usersPageInfo').textContent = `Page ${data.page} of ${data.pages}`;
}

function changeUsersPage(delta) {
    const totalPages = parseInt(document.getElementById('usersPageInfo').textContent.split('of ')[1]);
    const newPage = usersPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        loadUsers(newPage);
    }
}

function filterUsers() {
    loadUsers(1);
}

function toggleAllUsers() {
    const checked = document.getElementById('selectAllUsers').checked;
    document.querySelectorAll('.user-checkbox').forEach(cb => cb.checked = checked);
    updateBulkActions();
}

function updateBulkActions() {
    const checked = document.querySelectorAll('.user-checkbox:checked').length;
    // Show/hide bulk action buttons
}

function showAddUser() {
    document.getElementById('addUserModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    document.getElementById('addUserForm').reset();
}

function closeAddUser() {
    document.getElementById('addUserModal').classList.remove('active');
    document.body.style.overflow = 'auto';
}

function closeViewUser() {
    document.getElementById('viewUserModal').classList.remove('active');
    document.body.style.overflow = 'auto';
}

function closeEditUser() {
    document.getElementById('editUserModal').classList.remove('active');
    document.body.style.overflow = 'auto';
    currentEditingUserId = null;
}

document.getElementById('addUserForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const username = document.getElementById('newUsername').value.trim();
    const email = document.getElementById('newEmail').value.trim();
    const password = document.getElementById('newPassword').value;
    const isAdmin = document.getElementById('newIsAdmin').checked;
    
    if (!username || !email || !password) {
        showError('Please fill in all required fields');
        return;
    }
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password, confirm_password: password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (isAdmin) {
                const toggleResponse = await fetch(`/api/admin/users/${data.user_id}/toggle-admin`, {
                    method: 'PUT'
                });
            }
            
            showSuccess(`User "${username}" created successfully!`);
            closeAddUser();
            loadUsers();
            loadAdminStats();
        } else {
            showError(data.error || 'Failed to create user');
        }
    } catch (error) {
        console.error('Error creating user:', error);
        showError('An error occurred. Please try again.');
    }
});

async function viewUser(userId) {
    try {
        const response = await fetch(`/api/admin/users/${userId}`);
        if (!response.ok) {
            const data = await response.json();
            showError(data.error || 'Failed to load user details');
            return;
        }

        const user = await response.json();
        const detailContent = document.getElementById('userDetailContent');
        detailContent.innerHTML = `
            <div class="detail-grid">
                <div class="detail-info-item"><label>ID</label><p>#${user.id}</p></div>
                <div class="detail-info-item"><label>Username</label><p>${user.username}</p></div>
                <div class="detail-info-item"><label>Email</label><p>${user.email}</p></div>
                <div class="detail-info-item"><label>Role</label><p>${user.is_admin ? 'Admin' : 'User'}</p></div>
                <div class="detail-info-item"><label>Status</label><p>${user.is_active ? 'Active' : 'Inactive'}</p></div>
                <div class="detail-info-item"><label>Joined</label><p>${formatDate(user.created_at)}</p></div>
                <div class="detail-info-item"><label>Detections</label><p>${user.detection_count || 0}</p></div>
                <div class="detail-info-item"><label>Last Login</label><p>${user.last_login ? formatDate(user.last_login) : 'Never'}</p></div>
            </div>
            <div style="margin-top: 20px;">
                <h4>Recent Detections</h4>
                ${(user.detections || []).length ? user.detections.map(d => `
                    <div style="padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.08);">
                        <strong>${d.disease_name.replace('_', ' ')}</strong> - ${d.confidence}%<br>
                        <small>${formatDate(d.created_at)}</small>
                    </div>
                `).join('') : '<p style="color: var(--gray);">No detections available.</p>'}
            </div>
        `;

        document.getElementById('viewUserModal').classList.add('active');
        document.body.style.overflow = 'hidden';
    } catch (error) {
        console.error('Error loading user details:', error);
        showError('An error occurred. Please try again.');
    }
}

async function editUser(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    currentEditingUserId = userId;
    document.getElementById('editUsername').value = user.username || '';
    document.getElementById('editEmail').value = user.email || '';
    document.getElementById('editPassword').value = '';
    document.getElementById('editIsAdmin').checked = !!user.is_admin;
    document.getElementById('editIsActive').checked = !!user.is_active;

    document.getElementById('editUserModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

document.getElementById('editUserForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    if (!currentEditingUserId) return;

    const updateData = {
        username: document.getElementById('editUsername').value.trim(),
        email: document.getElementById('editEmail').value.trim(),
        is_admin: document.getElementById('editIsAdmin').checked,
        is_active: document.getElementById('editIsActive').checked
    };

    const password = document.getElementById('editPassword').value;
    if (password) {
        updateData.password = password;
    }

    try {
        const response = await fetch(`/api/admin/users/${currentEditingUserId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });

        if (response.ok) {
            showSuccess('User updated successfully!');
            closeEditUser();
            loadUsers();
            loadAdminStats();
        } else {
            const data = await response.json();
            showError(data.error || 'Failed to update user');
        }
    } catch (error) {
        console.error('Error updating user:', error);
        showError('An error occurred. Please try again.');
    }
});

async function toggleAdmin(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    
    const action = user.is_admin ? 'remove admin privileges from' : 'make admin';
    if (!confirm(`Are you sure you want to ${action} ${user.username}?`)) return;
    
    try {
        const response = await fetch(`/api/admin/users/${userId}/toggle-admin`, {
            method: 'PUT'
        });
        
        if (response.ok) {
            showSuccess(`User ${user.is_admin ? 'demoted from' : 'promoted to'} admin successfully!`);
            loadUsers();
            loadAdminStats();
        } else {
            const data = await response.json();
            showError(data.error || 'Failed to toggle admin status');
        }
    } catch (error) {
        console.error('Error toggling admin:', error);
        showError('An error occurred. Please try again.');
    }
}

async function deleteUser(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    
    if (!confirm(`Are you sure you want to delete user "${user.username}"? This cannot be undone.`)) return;
    
    try {
        const response = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showSuccess(`User "${user.username}" deleted successfully!`);
            loadUsers();
            loadAdminStats();
        } else {
            const data = await response.json();
            showError(data.error || 'Failed to delete user');
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        showError('An error occurred. Please try again.');
    }
}

function exportUsers() {
    // Export users as CSV
    const headers = ['ID', 'Username', 'Email', 'Role', 'Status', 'Detections', 'Joined'];
    const rows = allUsers.map(u => [
        u.id,
        u.username,
        u.email,
        u.is_admin ? 'Admin' : 'User',
        u.is_active ? 'Active' : 'Inactive',
        u.detection_count || 0,
        u.created_at
    ]);
    
    downloadCSV(headers, rows, 'users_export');
}

// ==================== DISEASE MANAGEMENT ====================

async function loadDiseases() {
    try {
        const response = await fetch('/api/admin/diseases');
        if (response.ok) {
            allDiseases = await response.json();
            renderDiseases(allDiseases);
        }
    } catch (error) {
        console.error('Error loading diseases:', error);
        showError('Failed to load diseases');
    }
}

function renderDiseases(diseases) {
    const grid = document.getElementById('diseaseGrid');
    
    if (!diseases || diseases.length === 0) {
        grid.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--gray);">
                <i class="fas fa-disease" style="font-size: 3rem; display: block; margin-bottom: 10px;"></i>
                <p>No diseases added yet</p>
            </div>
        `;
        return;
    }
    
    grid.innerHTML = diseases.map(d => `
        <div class="disease-card-admin" style="animation: fadeIn 0.3s ease;">
            <div class="disease-card-header">
                <h4>${d.name}</h4>
                <span class="severity-badge ${d.severity?.toLowerCase() || 'medium'}">${d.severity || 'Medium'}</span>
            </div>
            <div class="disease-card-body">
                <p><strong>Scientific Name:</strong> ${d.scientific_name || 'N/A'}</p>
                <p><strong>Description:</strong> ${d.description || 'No description'}</p>
                <p><strong>Symptoms:</strong> ${d.symptoms || 'No symptoms listed'}</p>
            </div>
            <div class="disease-card-actions">
                <button class="action-btn edit" onclick="editDisease(${d.id})">
                    <i class="fas fa-edit"></i> Edit
                </button>
                <button class="action-btn delete" onclick="deleteDisease(${d.id})">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
        </div>
    `).join('');
}

function showAddDisease() {
    document.getElementById('addDiseaseModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    document.getElementById('addDiseaseForm').reset();
    currentEditingDiseaseId = null;
    document.getElementById('diseaseModalTitle').textContent = 'Add New Disease';
    document.getElementById('diseaseSubmitButton').textContent = 'Add Disease';
}

function showEditDisease(disease) {
    currentEditingDiseaseId = disease.id;
    document.getElementById('diseaseModalTitle').textContent = 'Edit Disease';
    document.getElementById('diseaseSubmitButton').textContent = 'Update Disease';
    document.getElementById('diseaseName').value = disease.name || '';
    document.getElementById('diseaseScientificName').value = disease.scientific_name || '';
    document.getElementById('diseaseSeverity').value = disease.severity || 'Medium';
    document.getElementById('diseaseDescription').value = disease.description || '';
    document.getElementById('diseaseSymptoms').value = disease.symptoms || '';
    document.getElementById('diseaseTreatment').value = disease.treatment || '';
    document.getElementById('diseasePrevention').value = disease.prevention || '';
    document.getElementById('addDiseaseModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeAddDisease() {
    document.getElementById('addDiseaseModal').classList.remove('active');
    document.body.style.overflow = 'auto';
    currentEditingDiseaseId = null;
}

document.getElementById('addDiseaseForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const diseaseData = {
        name: document.getElementById('diseaseName').value.trim(),
        scientific_name: document.getElementById('diseaseScientificName').value.trim(),
        severity: document.getElementById('diseaseSeverity').value,
        description: document.getElementById('diseaseDescription').value.trim(),
        symptoms: document.getElementById('diseaseSymptoms').value.trim(),
        treatment: document.getElementById('diseaseTreatment').value.trim(),
        prevention: document.getElementById('diseasePrevention').value.trim()
    };
    
    if (!diseaseData.name) {
        showError('Disease name is required');
        return;
    }
    
    try {
        const isEditing = currentEditingDiseaseId !== null;
        const endpoint = isEditing
            ? `/api/admin/diseases/${currentEditingDiseaseId}`
            : '/api/admin/diseases';
        const response = await fetch(endpoint, {
            method: isEditing ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(diseaseData)
        });
        
        if (response.ok) {
            showSuccess(isEditing ? 'Disease updated successfully.' : 'Disease added successfully!');
            closeAddDisease();
            loadDiseases();
        } else {
            const data = await response.json();
            showError(data.error || 'Failed to add disease');
        }
    } catch (error) {
        console.error('Error adding disease:', error);
        showError('An error occurred. Please try again.');
    }
});

async function editDisease(diseaseId) {
    try {
        const response = await fetch(`/api/admin/diseases/${diseaseId}`);
        if (!response.ok) throw new Error('Disease not found');
        showEditDisease(await response.json());
    } catch (error) {
        console.error('Error loading disease:', error);
        showError('Failed to load disease details');
    }
}

async function deleteDisease(diseaseId) {
    const disease = allDiseases.find(d => d.id === diseaseId);
    if (!disease) return;
    
    if (!confirm(`Are you sure you want to delete "${disease.name}"?`)) return;
    
    try {
        const response = await fetch(`/api/admin/diseases/${diseaseId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showSuccess(`"${disease.name}" deleted successfully!`);
            loadDiseases();
        } else {
            const data = await response.json();
            showError(data.error || 'Failed to delete disease');
        }
    } catch (error) {
        console.error('Error deleting disease:', error);
        showError('An error occurred. Please try again.');
    }
}

function importDiseases() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.json';
    input.onchange = async function(e) {
        const file = this.files[0];
        if (!file) return;
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch('/api/admin/diseases/import', {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                showSuccess('Diseases imported successfully!');
                loadDiseases();
            } else {
                const data = await response.json();
                showError(data.error || 'Failed to import diseases');
            }
        } catch (error) {
            console.error('Error importing diseases:', error);
            showError('An error occurred. Please try again.');
        }
    };
    input.click();
}

function exportDiseases() {
    window.location.href = '/api/admin/diseases/export?format=csv';
}

// ==================== DETECTION MANAGEMENT ====================

async function loadDetections(page = 1) {
    detectionsPage = page;
    
    try {
        const response = await fetch(`/api/admin/detections?page=${page}`);
        if (response.ok) {
            const data = await response.json();
            allDetections = data.detections || [];
            renderDetections(allDetections);
            updateDetectionsPagination(data);
            
            // Update disease filter options
            const filter = document.getElementById('diseaseFilter');
            const diseases = [...new Set(allDetections.map(d => d.disease_name))];
            filter.innerHTML = `
                <option value="all">All Diseases</option>
                ${diseases.map(d => `<option value="${d}">${d.replace('_', ' ')}</option>`).join('')}
            `;
        }
    } catch (error) {
        console.error('Error loading detections:', error);
        showError('Failed to load detections');
    }
}

function renderDetections(detections) {
    const tbody = document.getElementById('detectionsTableBody');
    
    if (!detections || detections.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: var(--gray);">
                    <i class="fas fa-leaf" style="font-size: 2rem; display: block; margin-bottom: 10px;"></i>
                    No detections found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = detections.map((d, index) => `
        <tr style="animation: fadeIn 0.3s ease ${index * 0.05}s both;">
            <td><span class="detection-id">#${d.id}</span></td>
            <td>${d.user || 'Unknown'}</td>
            <td>
                <span class="disease-status ${d.disease_name === 'Healthy' ? 'healthy' : 'diseased'}">
                    ${d.disease_name.replace('_', ' ')}
                </span>
            </td>
            <td>
                <span class="confidence-badge ${getConfidenceClass(d.confidence)}">
                    ${d.confidence}%
                </span>
            </td>
            <td>${formatDate(d.date)}</td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn view" onclick="viewDetection(${d.id})" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="action-btn delete" onclick="deleteDetection(${d.id})" title="Delete Detection">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function updateDetectionsPagination(data) {
    const pageInfo = document.getElementById('detectionsPageInfo');
    if (pageInfo) {
        pageInfo.textContent = `Page ${data.page} of ${data.pages || 1}`;
    }
}

function changeDetectionsPage(delta) {
    const totalPages = parseInt(document.getElementById('detectionsPageInfo').textContent.split('of ')[1]) || 1;
    const newPage = detectionsPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        loadDetections(newPage);
    }
}

function filterDetections() {
    const search = document.getElementById('detectionSearch').value.toLowerCase();
    const disease = document.getElementById('diseaseFilter').value;
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    
    let filtered = allDetections;
    
    if (search) {
        filtered = filtered.filter(d => 
            d.disease_name.toLowerCase().includes(search) ||
            (d.user && d.user.toLowerCase().includes(search))
        );
    }
    
    if (disease !== 'all') {
        filtered = filtered.filter(d => d.disease_name === disease);
    }
    
    if (dateFrom) {
        filtered = filtered.filter(d => d.date >= dateFrom);
    }
    
    if (dateTo) {
        filtered = filtered.filter(d => d.date <= dateTo);
    }
    
    renderDetections(filtered);
}

function getConfidenceClass(confidence) {
    if (confidence >= 85) return 'high';
    if (confidence >= 70) return 'medium';
    return 'low';
}

function closeViewDetection() {
    document.getElementById('viewDetectionModal').classList.remove('active');
    document.body.style.overflow = 'auto';
}

function closeEditDetection() {
    document.getElementById('editDetectionModal').classList.remove('active');
    document.body.style.overflow = 'auto';
    currentEditingDetectionId = null;
}

async function viewDetection(id) {
    try {
        const response = await fetch(`/api/admin/detections/${id}`);
        if (!response.ok) {
            const data = await response.json();
            showError(data.error || 'Failed to load detection details');
            return;
        }

        const detection = await response.json();
        document.getElementById('detectionDetailContent').innerHTML = `
            <div class="detail-grid">
                <div class="detail-info-item"><label>ID</label><p>#${detection.id}</p></div>
                <div class="detail-info-item"><label>User</label><p>${detection.user}</p></div>
                <div class="detail-info-item"><label>Disease</label><p>${detection.disease_name.replace('_', ' ')}</p></div>
                <div class="detail-info-item"><label>Confidence</label><p>${detection.confidence}%</p></div>
                <div class="detail-info-item"><label>Date</label><p>${detection.date}</p></div>
            </div>
            <div class="detail-images" style="margin-top: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
                <div>
                    <h4>Original Image</h4>
                    <img src="${detection.image_url}" alt="Original Image" style="width: 100%; border-radius: 12px;">
                </div>
                <div>
                    <h4>Heatmap</h4>
                    <img src="${detection.heatmap_url || detection.image_url}" alt="Heatmap" style="width: 100%; border-radius: 12px;">
                </div>
            </div>
            <div style="margin-top: 20px;">
                <h4>Treatment</h4>
                <p>${typeof detection.treatment === 'string' ? detection.treatment : JSON.stringify(detection.treatment || {}, null, 2)}</p>
            </div>
        `;

        document.getElementById('viewDetectionModal').classList.add('active');
        document.body.style.overflow = 'hidden';
    } catch (error) {
        console.error('Error loading detection details:', error);
        showError('An error occurred. Please try again.');
    }
}

async function editDetection(id) {
    const response = await fetch(`/api/admin/detections/${id}`);
    if (!response.ok) {
        const data = await response.json();
        showError(data.error || 'Failed to load detection details');
        return;
    }

    const detection = await response.json();
    currentEditingDetectionId = id;
    document.getElementById('editDetectionName').value = detection.disease_name || '';
    document.getElementById('editDetectionConfidence').value = detection.confidence ?? '';
    document.getElementById('editDetectionTreatment').value = typeof detection.treatment === 'string'
        ? detection.treatment
        : JSON.stringify(detection.treatment || {}, null, 2);

    document.getElementById('editDetectionModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

document.getElementById('editDetectionForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    if (!currentEditingDetectionId) return;

    const updateData = {
        disease_name: document.getElementById('editDetectionName').value.trim(),
        confidence: Number(document.getElementById('editDetectionConfidence').value),
        treatment: document.getElementById('editDetectionTreatment').value.trim()
    };

    try {
        const response = await fetch(`/api/admin/detections/${currentEditingDetectionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });

        if (response.ok) {
            showSuccess('Detection updated successfully!');
            closeEditDetection();
            loadDetections();
            loadAdminStats();
        } else {
            const data = await response.json();
            showError(data.error || 'Failed to update detection');
        }
    } catch (error) {
        console.error('Error updating detection:', error);
        showError('An error occurred. Please try again.');
    }
});

async function deleteDetection(id) {
    if (!confirm('Are you sure you want to delete this detection?')) return;
    
    try {
        const response = await fetch(`/api/detection/${id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showSuccess('Detection deleted successfully!');
            loadDetections();
            loadAdminStats();
        } else {
            const data = await response.json();
            showError(data.error || 'Failed to delete detection');
        }
    } catch (error) {
        console.error('Error deleting detection:', error);
        showError('An error occurred. Please try again.');
    }
}

function exportDetections() {
    const headers = ['ID', 'User', 'Disease', 'Confidence', 'Date'];
    const rows = allDetections.map(d => [
        d.id,
        d.user || 'Unknown',
        d.disease_name.replace('_', ' '),
        d.confidence,
        d.date
    ]);
    
    downloadCSV(headers, rows, 'detections_export');
}

function setupEventListeners() {
    const globalSearch = document.getElementById('globalSearch');
    if (globalSearch) {
        globalSearch.addEventListener('input', debounce(function() {
            const query = this.value.toLowerCase();

            if (currentAdminTab === 'users') {
                document.getElementById('userSearch').value = query;
                filterUsers();
            } else if (currentAdminTab === 'detections') {
                document.getElementById('detectionSearch').value = query;
                filterDetections();
            }
        }, 300));
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function downloadCSV(headers, rows, filename) {
    let csv = headers.join(',') + '\n';
    csv += rows.map(row => row.join(',')).join('\n');
    
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ==================== REPORTS ====================

function generateReport() {
    reportViewerMode = false;
    document.getElementById('reportModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    document.querySelector('#reportModal .modal-header h3').textContent = 'Generate Report';
    document.getElementById('reportGenerationSection').style.display = 'block';
    document.getElementById('reportResult').style.display = 'none';
    document.getElementById('reportForm').reset();
}

function closeReportModal() {
    document.getElementById('reportModal').classList.remove('active');
    document.body.style.overflow = 'auto';
}

document.getElementById('reportForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const selectedDates = getReportDates();
    const reportData = {
        type: document.getElementById('reportType').value,
        date_from: selectedDates.date_from,
        date_to: selectedDates.date_to
    };
    
    try {
        const response = await fetch('/api/admin/reports/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reportData)
        });
        
        if (response.ok) {
            const data = await response.json();
            currentReportId = data.report_id;
            if (reportViewerMode) {
                displayEnhancedReport(data.data, data);
            } else {
                closeReportModal();
                showSuccess('Report generated successfully.');
            }
            loadReports();
        } else {
            const data = await response.json();
            showError(data.error || 'Failed to generate report');
        }
    } catch (error) {
        console.error('Error generating report:', error);
        showError('An error occurred. Please try again.');
    }
});

function getReportDates() {
    const preset = document.getElementById('reportDatePreset').value;
    const today = new Date();
    const toDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let fromDate = null;

    if (preset === 'today') fromDate = new Date(toDate);
    if (preset === 'yesterday') {
        fromDate = new Date(toDate);
        fromDate.setDate(fromDate.getDate() - 1);
        toDate.setDate(toDate.getDate() - 1);
    }
    if (preset === '7' || preset === '30') {
        fromDate = new Date(toDate);
        fromDate.setDate(fromDate.getDate() - Number(preset) + 1);
    }
    if (preset === 'month') fromDate = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
    if (preset === 'year') fromDate = new Date(toDate.getFullYear(), 0, 1);
    if (preset === 'custom') {
        return {
            date_from: document.getElementById('reportDateFrom').value,
            date_to: document.getElementById('reportDateTo').value
        };
    }

    return {
        date_from: fromDate ? toInputDate(fromDate) : '',
        date_to: preset === 'all' ? '' : toInputDate(toDate)
    };
}

function toInputDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function displayEnhancedReport(data, metadata = {}) {
    currentReportPreview = data;
    const result = document.getElementById('reportResult');
    document.getElementById('reportMeta').innerHTML = `
        <strong>${document.getElementById('reportType').selectedOptions[0].text}</strong>
        <span>Generated: ${formatDate(metadata.generated_at || new Date().toISOString())}</span>
        <span>Period: ${metadata.date_from || 'All time'}${metadata.date_to ? ` to ${metadata.date_to}` : ''}</span>
        <span>Data source: Current application database</span>
    `;
    const container = document.getElementById('reportContent');
    if (data.type === 'summary') {
        container.innerHTML = `
            <div class="report-stat-grid">
                ${[['Total Users', data.total_users], ['Farmers', data.total_farmers], ['Admins', data.total_admins], ['Disease Records', data.total_diseases], ['Detections', data.total_detections], ['Successful', data.successful_detections], ['Failed', data.failed_detections], ['Most Active User', data.most_active_user || 'N/A']].map(item => `<div class="report-stat"><strong>${item[1]}</strong><span>${item[0]}</span></div>`).join('')}
            </div>
            <div class="report-section"><h4>Disease Distribution</h4>${Object.entries(data.disease_distribution || {}).map(([name, count]) => `<div class="report-bar-row"><span>${escapeHtml(name)}</span><b>${count}</b></div>`).join('') || '<p>No detections in this period.</p>'}</div>
            <div class="report-section"><h4>Recent Activity</h4>${renderActivityTable(data.recent_activity || [])}</div>
        `;
    } else if (data.type === 'detailed') {
        container.innerHTML = `
            <div class="report-toolbar"><input type="search" placeholder="Search user, email, or disease" oninput="filterReportTable(this.value)"><span>${data.total} detections</span></div>
            <div class="report-table-wrap"><table class="admin-table" id="reportDetailTable"><thead><tr><th>ID</th><th>User</th><th>Email</th><th>Disease</th><th>Confidence</th><th>Result</th><th>Date</th><th>Treatment</th></tr></thead><tbody>${(data.detections || []).map(d => `<tr><td>${d.id}</td><td>${escapeHtml(d.user)}</td><td>${escapeHtml(d.user_email)}</td><td>${escapeHtml(d.disease_name)}</td><td>${(d.confidence * 100).toFixed(2)}%</td><td>${escapeHtml(d.result)}</td><td>${formatDate(d.created_at)}</td><td>${escapeHtml(typeof d.treatment === 'string' ? d.treatment : d.treatment ? JSON.stringify(d.treatment) : 'Not available')}</td></tr>`).join('') || '<tr><td colspan="8">No detections in this period.</td></tr>'}</tbody></table></div>
        `;
    } else if (data.type === 'disease_distribution') {
        const entries = Object.entries(data.diseases || {});
        container.innerHTML = `
            <div class="report-stat-grid"><div class="report-stat"><strong>${data.total_detections}</strong><span>Total Detections</span></div><div class="report-stat"><strong>${escapeHtml(data.most_detected || 'N/A')}</strong><span>Most Detected</span></div><div class="report-stat"><strong>${escapeHtml(data.least_detected || 'N/A')}</strong><span>Least Detected</span></div></div>
            <div class="report-table-wrap"><table class="admin-table"><thead><tr><th>Disease</th><th>Detections</th><th>Percentage</th><th>Avg. Confidence</th></tr></thead><tbody>${entries.map(([name, info]) => `<tr><td>${escapeHtml(name)}</td><td>${info.count}</td><td>${Number(info.percentage).toFixed(2)}%</td><td>${(info.avg_confidence * 100).toFixed(2)}%</td></tr>`).join('') || '<tr><td colspan="4">No detections in this period.</td></tr>'}</tbody></table></div>
        `;
    } else if (data.type === 'user_activity') {
        container.innerHTML = `<div class="report-stat-grid"><div class="report-stat"><strong>${data.total_activities}</strong><span>Activities</span></div><div class="report-stat"><strong>${Object.keys(data.users || {}).length}</strong><span>Active Users</span></div><div class="report-stat"><strong>${data.total_detections}</strong><span>Detections</span></div></div><div class="report-table-wrap"><table class="admin-table" id="reportActivityTable"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Logins</th><th>Detections</th><th>Last Activity</th><th>Activity</th></tr></thead><tbody>${Object.entries(data.users || {}).map(([name, info]) => `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(info.email)}</td><td>${info.role}</td><td>${info.login_count}</td><td>${info.detection_count}</td><td>${formatDate(info.last_active_time)}</td><td>${escapeHtml(info.most_recent_activity)}</td></tr>`).join('') || '<tr><td colspan="7">No activity in this period.</td></tr>'}</tbody></table></div><div class="report-section"><h4>Activity Timeline</h4>${renderActivityTable(data.activities || [])}</div>`;
    }
    result.style.display = 'block';
}

function renderActivityTable(activities) {
    if (!activities.length) return '<p>No activity in this period.</p>';
    return `<div class="report-table-wrap"><table class="admin-table"><thead><tr><th>User</th><th>Activity</th><th>Details</th><th>Date</th></tr></thead><tbody>${activities.map(item => `<tr><td>${escapeHtml(item.user)}</td><td>${escapeHtml(item.activity)}</td><td>${escapeHtml(item.details || '')}</td><td>${formatDate(item.created_at)}</td></tr>`).join('')}</tbody></table></div>`;
}

function filterReportTable(query) {
    const value = query.toLowerCase();
    document.querySelectorAll('#reportDetailTable tbody tr, #reportActivityTable tbody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(value) ? '' : 'none';
    });
}

function displayReport(data) {
    const container = document.getElementById('reportContent');
    
    if (data.type === 'summary') {
        container.innerHTML = `
            <div class="report-summary">
                <h4>Summary Report</h4>
                <div class="report-stats">
                    <div><strong>Total Detections:</strong> ${data.total_detections}</div>
                    <div><strong>Unique Diseases:</strong> ${data.unique_diseases}</div>
                    <div><strong>Most Common Disease:</strong> ${data.most_common_disease || 'N/A'}</div>
                    <div><strong>Average Confidence:</strong> ${(data.avg_confidence * 100).toFixed(2)}%</div>
                </div>
                <div class="report-disease-distribution">
                    <h5>Disease Distribution</h5>
                    ${Object.entries(data.disease_distribution).map(([disease, count]) => `
                        <div class="report-disease-item">
                            <span>${disease.replace('_', ' ')}</span>
                            <span>${count}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else if (data.type === 'detailed') {
        container.innerHTML = `
            <div class="report-detailed">
                <h4>Detailed Report (${data.total} detections)</h4>
                <div class="report-table">
                    ${data.detections.slice(0, 20).map(d => `
                        <div class="report-detection-item">
                            <span>#${d.id}</span>
                            <span>${d.disease_name.replace('_', ' ')}</span>
                            <span>${(d.confidence * 100).toFixed(2)}%</span>
                            <span>${d.user || 'Unknown'}</span>
                            <span>${formatDate(d.created_at)}</span>
                        </div>
                    `).join('')}
                    ${data.total > 20 ? `<p>... and ${data.total - 20} more detections</p>` : ''}
                </div>
            </div>
        `;
    } else if (data.type === 'disease_distribution') {
        container.innerHTML = `
            <div class="report-distribution">
                <h4>Disease Distribution Report</h4>
                <div class="report-stats">
                    <div><strong>Total Detections:</strong> ${data.total_detections}</div>
                </div>
                <div class="report-disease-distribution">
                    ${Object.entries(data.diseases).map(([disease, info]) => `
                        <div class="report-disease-item">
                            <span>${disease.replace('_', ' ')}</span>
                            <span>${info.count} (${(info.avg_confidence * 100).toFixed(2)}% avg confidence)</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else if (data.type === 'user_activity') {
        container.innerHTML = `
            <div class="report-user-activity">
                <h4>User Activity Report</h4>
                <div class="report-stats">
                    <div><strong>Total Detections:</strong> ${data.total_detections}</div>
                    <div><strong>Active Users:</strong> ${Object.keys(data.users).length}</div>
                </div>
                <div class="report-user-list">
                    ${Object.entries(data.users).map(([user, info]) => `
                        <div class="report-user-item">
                            <span><strong>${user}</strong></span>
                            <span>${info.detection_count} detections</span>
                            <span>${Object.entries(info.diseases).map(([disease, count]) => 
                                `${disease.replace('_', ' ')}: ${count}`
                            ).join(', ')}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
}

function downloadReport(format) {
    if (!currentReportId) {
        showError('No report to download');
        return;
    }
    
    window.location.href = `/api/admin/reports/download/${currentReportId}?format=${format}`;
}

function generateQuickReport(type) {
    reportViewerMode = true;
    document.getElementById('reportModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    document.querySelector('#reportModal .modal-header h3').textContent = `${document.querySelector(`#reportType option[value="${type}"]`).textContent}`;
    document.getElementById('reportGenerationSection').style.display = 'none';
    document.getElementById('reportResult').style.display = 'block';
    document.getElementById('reportContent').innerHTML = '<p class="notification-state">Loading report...</p>';
    document.getElementById('reportType').value = type;
    document.getElementById('reportForm').dispatchEvent(new Event('submit'));
}

async function loadReports() {
    try {
        const response = await fetch('/api/admin/reports/list');
        if (response.ok) {
            const reports = await response.json();
            const container = document.getElementById('reportsContainer');
            
            if (!reports || reports.length === 0) {
                container.innerHTML = '<p style="color: var(--gray);">No reports generated yet</p>';
                return;
            }
            
            container.innerHTML = reports.map(r => `
                <div class="report-history-item">
                    <span><i class="fas fa-file-alt"></i> ${r.type.replace('_', ' ')}</span>
                    <span>${formatDate(r.generated_at)}${r.date_from ? ` | ${r.date_from} to ${r.date_to || 'today'}` : ''}</span>
                    <div>
                        <button onclick="viewReportFromHistory('${r.id}')" class="action-btn view">
                            <i class="fas fa-eye"></i> View
                        </button>
                        <button onclick="downloadReportFromHistory('${r.id}', 'pdf')" class="action-btn view">
                            <i class="fas fa-file-pdf"></i> PDF
                        </button>
                        <button onclick="downloadReportFromHistory('${r.id}', 'csv')" class="action-btn edit">
                            <i class="fas fa-file-csv"></i> CSV
                        </button>
                        <button onclick="deleteReport('${r.id}')" class="action-btn delete">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading reports:', error);
    }
}

function downloadReportFromHistory(reportId, format) {
    window.location.href = `/api/admin/reports/download/${reportId}?format=${format}`;
}

async function deleteReport(reportId) {
    if (!confirm('Delete Report?\n\nAre you sure you want to delete this report? This action cannot be undone.')) return;
    try {
        const response = await fetch(`/api/admin/reports/${reportId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Unable to delete report');
        if (currentReportId === reportId) {
            currentReportId = null;
            closeReportModal();
        }
        await loadReports();
        showSuccess('Report deleted successfully.');
    } catch (error) {
        console.error('Error deleting report:', error);
        showError('Unable to delete report. Please try again.');
    }
}

async function viewReportFromHistory(reportId) {
    try {
        const response = await fetch(`/api/admin/reports/${reportId}`);
        if (!response.ok) throw new Error('Report not found');
        const report = await response.json();
        currentReportId = report.report_id;
        document.getElementById('reportType').value = report.type;
        reportViewerMode = true;
        document.querySelector('#reportModal .modal-header h3').textContent = `${document.querySelector(`#reportType option[value="${report.type}"]`).textContent}`;
        document.getElementById('reportGenerationSection').style.display = 'none';
        document.getElementById('reportModal').classList.add('active');
        document.body.style.overflow = 'hidden';
        displayEnhancedReport(report.data, report);
    } catch (error) {
        console.error('Error loading report:', error);
        showError('Unable to load saved report');
    }
}

// ==================== LOGS ====================

async function loadLogs(page = 1) {
    logsPage = page;
    
    try {
        const response = await fetch(`/api/admin/logs?page=${page}`);
        if (response.ok) {
            const data = await response.json();
            allLogs = data.logs;
            renderLogs(data.logs);
            updateLogsPagination(data);
        }
    } catch (error) {
        console.error('Error loading logs:', error);
        showError('Failed to load logs');
    }
}

function renderLogs(logs) {
    const container = document.getElementById('logContainer');
    
    if (!logs || logs.length === 0) {
        container.innerHTML = `
            <div class="log-empty">
                <i class="fas fa-history"></i>
                <p>No logs available</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = logs.map(log => `
        <div class="log-entry">
            <span class="log-time">${formatDate(log.created_at)}</span>
            <span class="log-user">[${log.user || 'System'}]</span>
            <span class="log-action">${log.action}</span>
            ${log.details ? `<span class="log-details">- ${log.details}</span>` : ''}
            <span class="log-ip">(${log.ip_address || 'N/A'})</span>
        </div>
    `).join('');
}

function updateLogsPagination(data) {
    document.getElementById('logsPageInfo').textContent = `Page ${data.page} of ${data.pages}`;
}

function changeLogsPage(delta) {
    const totalPages = parseInt(document.getElementById('logsPageInfo').textContent.split('of ')[1]);
    const newPage = logsPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        loadLogs(newPage);
    }
}

function clearLogs() {
    if (!confirm('Are you sure you want to clear all system logs?')) return;
    
    // Implementation would go here
    showSuccess('Logs cleared successfully!');
    loadLogs();
}

// ==================== UTILITY FUNCTIONS ====================

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function showError(message) {
    showToast(message, 'error');
}

function showSuccess(message) {
    showToast(message, 'success');
}

function showToast(message, type = 'info') {
    // Remove existing toast
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

function refreshData() {
    loadAdminStats();
    loadUsers();
    loadDiseases();
    loadDetections();
    loadLogs();
    loadReports();
    loadCharts();
    showSuccess('Data refreshed successfully!');
}

function showNotifications() {
    const existingPanel = document.getElementById('notificationPanel');
    if (existingPanel) {
        existingPanel.remove();
        return;
    }

    const panel = document.createElement('div');
    panel.id = 'notificationPanel';
    panel.className = 'admin-notification-panel';
    panel.innerHTML = `
        <div class="admin-notification-header">
            <h3>Notifications</h3>
            <div>
                <button class="mark-all-read-btn" onclick="markAllNotificationsRead()">Mark all as read</button>
                <button class="notification-close" onclick="document.getElementById('notificationPanel').remove()" aria-label="Close notifications">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
        <div class="admin-notification-list"><p class="notification-state">Loading notifications...</p></div>
    `;
    document.body.appendChild(panel);
    renderNotifications(panel.querySelector('.admin-notification-list'));
}

async function loadNotifications() {
    try {
        const response = await fetch('/api/admin/notifications');
        if (!response.ok) return;
        const data = await response.json();
        updateNotificationBadge(data.unread_count);
        const panel = document.getElementById('notificationPanel');
        if (panel) renderNotifications(panel.querySelector('.admin-notification-list'), data.notifications);
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

async function renderNotifications(container, notifications) {
    if (!notifications) {
        try {
            const response = await fetch('/api/admin/notifications');
            if (!response.ok) throw new Error('Unable to load notifications');
            const data = await response.json();
            notifications = data.notifications;
            updateNotificationBadge(data.unread_count);
        } catch (error) {
            container.innerHTML = '<p class="notification-state">Unable to load notifications</p>';
            return;
        }
    }

    if (!notifications.length) {
        container.innerHTML = '<p class="notification-state">No new notifications</p>';
        return;
    }

    container.innerHTML = notifications.map(notification => `
        <button class="admin-notification-item ${notification.is_read ? '' : 'unread'}" onclick="markNotificationRead(${notification.id})">
            <span class="notification-status" aria-label="${notification.is_read ? 'Read' : 'Unread'}"></span>
            <span class="notification-item-content">
                <strong>${escapeHtml(notification.message)}</strong>
                <small>${formatNotificationTime(notification.created_at)}</small>
            </span>
        </button>
    `).join('');
}

function updateNotificationBadge(unreadCount) {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    badge.textContent = unreadCount;
    badge.style.display = unreadCount ? 'flex' : 'none';
}

async function markNotificationRead(notificationId) {
    try {
        const response = await fetch(`/api/admin/notifications/${notificationId}/read`, { method: 'PUT' });
        if (!response.ok) throw new Error('Unable to mark notification as read');
        await loadNotifications();
    } catch (error) {
        showError('Unable to update notification. Please try again.');
    }
}

async function markAllNotificationsRead() {
    try {
        const response = await fetch('/api/admin/notifications/read-all', { method: 'PUT' });
        if (!response.ok) throw new Error('Unable to mark notifications as read');
        await loadNotifications();
    } catch (error) {
        showError('Unable to update notifications. Please try again.');
    }
}

function formatNotificationTime(value) {
    return value ? new Date(value).toLocaleString('en-IN', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata'
    }) + ' IST' : 'Not available';
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
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
}

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        localStorage.removeItem('user');
        window.location.href = '/login';
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// ==================== STYLES ====================

const adminStyles = `
.admin-notification-panel {
    position: fixed;
    top: 72px;
    right: 20px;
    width: min(390px, calc(100vw - 40px));
    max-height: 480px;
    background: var(--white);
    border-radius: var(--radius);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
    z-index: 9999;
    overflow: hidden;
}

.admin-notification-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px;
    border-bottom: 1px solid #e2e8f0;
}

.admin-notification-header h3 { margin: 0; font-size: 1rem; }
.admin-notification-header > div { display: flex; align-items: center; gap: 10px; }
.mark-all-read-btn, .notification-close {
    border: 0;
    background: transparent;
    color: var(--primary-dark);
    cursor: pointer;
}
.mark-all-read-btn { font-size: 0.78rem; }
.notification-close { color: var(--gray); font-size: 1rem; }
.admin-notification-list { max-height: 405px; overflow-y: auto; }
.admin-notification-item {
    width: 100%;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 15px 18px;
    border: 0;
    border-bottom: 1px solid #f1f5f9;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
}
.admin-notification-item:hover { background: #f8fafc; }
.admin-notification-item.unread { background: #f0fdf4; }
.notification-status {
    width: 9px;
    height: 9px;
    margin-top: 5px;
    flex: 0 0 9px;
    border-radius: 50%;
    background: transparent;
}
.admin-notification-item.unread .notification-status { background: var(--secondary); }
.notification-item-content { display: flex; flex-direction: column; gap: 4px; }
.notification-item-content strong { font-size: 0.88rem; font-weight: 600; }
.notification-item-content small, .notification-state { color: var(--gray); font-size: 0.78rem; }
.notification-state { padding: 28px 18px; text-align: center; margin: 0; }
.dark-theme .admin-notification-panel { background: #2d2d44; }
.dark-theme .admin-notification-header, .dark-theme .admin-notification-item { border-color: #3d3d5c; }
.dark-theme .admin-notification-item:hover { background: #3d3d5c; }

.disease-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 20px;
}

.disease-card-admin {
    background: var(--white);
    border-radius: var(--radius);
    padding: 20px;
    box-shadow: var(--shadow);
    transition: var(--transition);
}

.disease-card-admin:hover {
    transform: translateY(-5px);
    box-shadow: var(--shadow-hover);
}

.disease-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
}

.disease-card-header h4 {
    font-size: 1.1rem;
    margin: 0;
}

.severity-badge {
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 600;
}

.severity-badge.low { background: #dcfce7; color: #16a34a; }
.severity-badge.medium { background: #fef3c7; color: #d97706; }
.severity-badge.high { background: #fee2e2; color: #dc2626; }
.severity-badge.critical { background: #fce4ec; color: #c62828; }

.disease-card-body {
    margin-bottom: 15px;
}

.disease-card-body p {
    margin: 5px 0;
    font-size: 0.9rem;
    color: var(--gray);
}

.disease-card-actions {
    display: flex;
    gap: 10px;
}

.disease-card-actions button {
    flex: 1;
    padding: 8px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: var(--transition);
}

.status-badge {
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 600;
}

.status-badge.active { background: #dcfce7; color: #16a34a; }
.status-badge.inactive { background: #fee2e2; color: #dc2626; }

.reports-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 20px;
    margin-bottom: 30px;
}

.report-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    padding: 12px 15px;
    margin-bottom: 18px;
    background: #f8fafc;
    border-radius: 10px;
    font-size: 0.82rem;
}

.report-meta strong { color: var(--dark); width: 100%; font-size: 1.05rem; }
.report-meta span { color: var(--gray); }
.report-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 20px; }
.report-stat { padding: 15px; border-radius: 10px; background: #f8fafc; text-align: center; }
.report-stat strong { display: block; color: var(--primary-dark); font-size: 1.25rem; overflow-wrap: anywhere; }
.report-stat span { color: var(--gray); font-size: 0.78rem; }
.report-section { margin: 20px 0; }
.report-section h4 { margin-bottom: 10px; }
.report-bar-row { display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
.report-toolbar { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 12px; }
.report-toolbar input { flex: 1; padding: 9px 12px; border: 1px solid #dbe3ea; border-radius: 8px; }
.report-table-wrap { overflow-x: auto; }
.report-table-wrap .admin-table { min-width: 760px; }
.dark-theme .report-meta, .dark-theme .report-stat { background: #3d3d5c; }
.dark-theme .report-bar-row { border-bottom-color: #3d3d5c; }

.report-card {
    background: var(--white);
    padding: 30px;
    border-radius: var(--radius);
    text-align: center;
    box-shadow: var(--shadow);
    cursor: pointer;
    transition: var(--transition);
}

.report-card:hover {
    transform: translateY(-5px);
    box-shadow: var(--shadow-hover);
}

.report-card i {
    font-size: 2.5rem;
    color: var(--primary);
    margin-bottom: 10px;
}

.report-card h4 {
    margin: 5px 0;
}

.report-card p {
    color: var(--gray);
    font-size: 0.9rem;
    margin: 0;
}

.report-history-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 15px;
    background: #f8fafc;
    border-radius: 10px;
    margin-bottom: 10px;
}

.report-history-item .action-btn {
    padding: 4px 10px;
    border: none;
    border-radius: 6px;
    font-size: 0.75rem;
    cursor: pointer;
    margin: 0 5px;
}

.log-entry {
    padding: 8px 12px;
    border-bottom: 1px solid #f1f5f9;
    font-size: 0.9rem;
    font-family: 'Courier New', monospace;
}

.log-entry .log-time { color: var(--gray); margin-right: 10px; }
.log-entry .log-user { color: var(--primary); margin-right: 10px; }
.log-entry .log-action { font-weight: 500; }
.log-entry .log-details { color: var(--gray); }
.log-entry .log-ip { color: var(--gray); font-size: 0.8rem; }

.dark-theme .log-entry {
    border-bottom-color: #3d3d5c;
}

.dark-theme .report-card {
    background: #2d2d44;
}

.dark-theme .report-history-item {
    background: #3d3d5c;
}

.dark-theme .disease-card-admin {
    background: #2d2d44;
}

.dark-theme .log-entry .log-time { color: #a0aec0; }
.dark-theme .log-entry .log-details { color: #a0aec0; }
.dark-theme .log-entry .log-ip { color: #a0aec0; }
`;

if (!document.getElementById('adminStyles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'adminStyles';
    styleEl.textContent = adminStyles;
    document.head.appendChild(styleEl);
}

// Load saved theme
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
    const icon = document.querySelector('.theme-toggle i');
    if (icon) icon.className = 'fas fa-sun';
}

// Modal close on outside click
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', function(e) {
        if (e.target === this) {
            this.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(modal => {
            modal.classList.remove('active');
            document.body.style.overflow = 'auto';
        });
    }
    if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        refreshData();
    }
});
