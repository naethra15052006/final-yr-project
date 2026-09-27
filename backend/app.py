import os
import json
import uuid
import shutil
import pandas as pd
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from urllib.parse import parse_qsl, urlencode
from sqlalchemy import text
from werkzeug.datastructures import MultiDict
import werkzeug.urls

if not hasattr(werkzeug.urls, 'url_decode'):
    def url_decode(query, *args, **kwargs):
        return MultiDict(parse_qsl(query, keep_blank_values=True))

    werkzeug.urls.url_decode = url_decode

if not hasattr(werkzeug.urls, 'url_encode'):
    def url_encode(values, sort=False, *args, **kwargs):
        items = values.items(multi=True) if hasattr(values, 'items') else values
        if sort:
            items = sorted(items)
        return urlencode(list(items), doseq=True)

    werkzeug.urls.url_encode = url_encode

from flask import Flask, request, jsonify, render_template, session, send_from_directory, send_file, Response, redirect
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_bcrypt import Bcrypt
from werkzeug.utils import secure_filename
import numpy as np
from PIL import Image
import tensorflow as tf
from io import BytesIO
import base64

from models.disease_model import DiseaseModel
from utils.image_processor import ImageProcessor
from utils.grad_cam import GradCAM
from database.db_manager import DatabaseManager

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INSTANCE_DB_PATH = os.path.join(BASE_DIR, 'instance', 'coconut_disease.db')
LEGACY_DB_PATHS = [
    os.path.join(BASE_DIR, 'coconut_disease.db'),
    os.path.abspath(os.path.join(BASE_DIR, '..', 'coconut_disease.db'))
]


def resolve_database_path():
    os.makedirs(os.path.dirname(INSTANCE_DB_PATH), exist_ok=True)

    if os.path.exists(INSTANCE_DB_PATH):
        return INSTANCE_DB_PATH

    existing_legacy_dbs = [path for path in LEGACY_DB_PATHS if os.path.exists(path)]
    if existing_legacy_dbs:
        source_db = max(existing_legacy_dbs, key=os.path.getsize)
        shutil.copy2(source_db, INSTANCE_DB_PATH)

    return INSTANCE_DB_PATH


DATABASE_PATH = resolve_database_path()
DATABASE_URI = f"sqlite:///{DATABASE_PATH.replace(os.sep, '/')}"

app = Flask(
    __name__,
    static_folder='../frontend',
    static_url_path='',
    template_folder='../frontend'
)
app.config['SECRET_KEY'] = 'your-secret-key-change-in-production'
app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URI
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.path.join(BASE_DIR, 'uploads')
app.config['DATASET_FOLDER'] = os.path.join(BASE_DIR, 'dataset')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max-limit

# Initialize extensions
db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login_page'
CORS(app)

# Initialize components
image_processor = ImageProcessor()
disease_model = DiseaseModel()
grad_cam = GradCAM()
grad_cam.set_model(disease_model.model)
db_manager = DatabaseManager(DATABASE_PATH)

# Allowed extensions
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp'}

# Database Models
class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime)
    detections = db.relationship('Detection', backref='user', lazy=True)

class Detection(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    image_path = db.Column(db.String(200), nullable=False)
    disease_name = db.Column(db.String(100), nullable=False)
    confidence = db.Column(db.Float, nullable=False)
    heatmap_path = db.Column(db.String(200))
    treatment = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class DiseaseInfo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    scientific_name = db.Column(db.String(200))
    description = db.Column(db.Text)
    symptoms = db.Column(db.Text)
    treatment = db.Column(db.Text)
    prevention = db.Column(db.Text)
    severity = db.Column(db.String(20))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class SystemLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    action = db.Column(db.String(200), nullable=False)
    details = db.Column(db.Text)
    ip_address = db.Column(db.String(50))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Notification(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    recipient_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    notification_type = db.Column(db.String(50), nullable=False)
    message = db.Column(db.String(255), nullable=False)
    related_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    is_read = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def parse_treatment_value(raw_treatment):
    if not raw_treatment:
        return None

    if isinstance(raw_treatment, (dict, list)):
        return raw_treatment

    try:
        return json.loads(raw_treatment)
    except (TypeError, json.JSONDecodeError):
        return raw_treatment

# Admin Required Decorator
def admin_required(f):
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    decorated_function.__name__ = f.__name__
    return decorated_function

# ==================== ADMIN ROUTES ====================

# ====== User Management ======

@app.route('/api/admin/users', methods=['GET'])
@login_required
@admin_required
def get_users():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    search = request.args.get('search', '')
    
    query = User.query
    if search:
        query = query.filter(
            db.or_(
                User.username.contains(search),
                User.email.contains(search)
            )
        )
    
    paginated = query.paginate(page=page, per_page=per_page, error_out=False)
    
    users_data = []
    for user in paginated.items:
        detection_count = Detection.query.filter_by(user_id=user.id).count()
        last_detection = Detection.query.filter_by(user_id=user.id).order_by(Detection.created_at.desc()).first()
        
        users_data.append({
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'is_admin': user.is_admin,
            'is_active': user.is_active,
            'detection_count': detection_count,
            'last_detection': last_detection.created_at.isoformat() if last_detection else None,
            'last_login': user.last_login.isoformat() if user.last_login else None,
            'created_at': user.created_at.isoformat()
        })
    
    return jsonify({
        'users': users_data,
        'total': paginated.total,
        'page': page,
        'per_page': per_page,
        'pages': paginated.pages
    })

@app.route('/api/admin/users/<int:user_id>', methods=['GET'])
@login_required
@admin_required
def get_user_detail(user_id):
    user = User.query.get_or_404(user_id)
    detections = Detection.query.filter_by(user_id=user_id).order_by(Detection.created_at.desc()).limit(10).all()
    
    return jsonify({
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'is_admin': user.is_admin,
        'is_active': user.is_active,
        'created_at': user.created_at.isoformat(),
        'last_login': user.last_login.isoformat() if user.last_login else None,
        'detections': [{
            'id': d.id,
            'disease_name': d.disease_name,
            'confidence': d.confidence,
            'created_at': d.created_at.isoformat()
        } for d in detections],
        'detection_count': Detection.query.filter_by(user_id=user_id).count()
    })

@app.route('/api/admin/users/<int:user_id>', methods=['PUT'])
@login_required
@admin_required
def update_user(user_id):
    user = User.query.get_or_404(user_id)
    data = request.get_json()
    
    if 'is_active' in data:
        user.is_active = data['is_active']
    if 'is_admin' in data and user_id != current_user.id:
        user.is_admin = data['is_admin']
    if 'username' in data:
        user.username = data['username']
    if 'email' in data:
        user.email = data['email']
    if 'password' in data and data['password']:
        user.password_hash = bcrypt.generate_password_hash(data['password']).decode('utf-8')
    
    db.session.commit()
    
    # Log the action
    log_action(current_user.id, f"Updated user {user.username}", f"User ID: {user_id}")
    
    return jsonify({'message': 'User updated successfully'})

@app.route('/api/admin/detections/<int:detection_id>', methods=['GET'])
@login_required
@admin_required
def get_detection_detail(detection_id):
    detection = Detection.query.get_or_404(detection_id)
    user = db.session.get(User, detection.user_id) if detection.user_id else None

    return jsonify({
        'id': detection.id,
        'user_id': detection.user_id,
        'user': user.username if user else 'Unknown',
        'disease_name': detection.disease_name,
        'confidence': round(float(detection.confidence) * 100, 2),
        'image_url': f'/uploads/{os.path.basename(detection.image_path)}',
        'heatmap_url': f'/uploads/{os.path.basename(detection.heatmap_path)}' if detection.heatmap_path else None,
        'treatment': parse_treatment_value(detection.treatment),
        'date': detection.created_at.strftime('%Y-%m-%d %H:%M:%S')
    }), 200

@app.route('/api/admin/detections/<int:detection_id>', methods=['PUT'])
@login_required
@admin_required
def update_detection(detection_id):
    detection = Detection.query.get_or_404(detection_id)
    data = request.get_json() or {}

    if 'disease_name' in data and data['disease_name']:
        detection.disease_name = data['disease_name']

    if 'confidence' in data and data['confidence'] is not None:
        confidence = float(data['confidence'])
        detection.confidence = confidence / 100 if confidence > 1 else confidence

    if 'treatment' in data:
        treatment = data['treatment']
        detection.treatment = json.dumps(treatment) if isinstance(treatment, (dict, list)) else treatment

    db.session.commit()
    log_action(current_user.id, f"Updated detection {detection.id}", f"Detection ID: {detection_id}")

    return jsonify({'message': 'Detection updated successfully'})

@app.route('/api/admin/users/<int:user_id>/toggle-admin', methods=['PUT'])
@login_required
@admin_required
def toggle_user_admin(user_id):
    user = User.query.get_or_404(user_id)

    if user.id == current_user.id:
        return jsonify({'error': 'Cannot change your own admin access'}), 400

    user.is_admin = not user.is_admin
    db.session.commit()

    role = 'admin' if user.is_admin else 'user'
    log_action(current_user.id, f"Changed role for {user.username}", f"New role: {role}")
    if user.is_admin:
        notify_admins(
            'admin_created',
            f'New admin account created: {user.username} ({user.email})',
            user.id
        )

    return jsonify({
        'message': f'{user.username} is now {role}',
        'is_admin': user.is_admin
    })

@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@login_required
@admin_required
def delete_user(user_id):
    user = User.query.get_or_404(user_id)
    
    if user.id == current_user.id:
        return jsonify({'error': 'Cannot delete your own account'}), 400
    
    username = user.username
    
    # Delete user's detections and files
    for detection in user.detections:
        try:
            if os.path.exists(detection.image_path):
                os.remove(detection.image_path)
            if detection.heatmap_path and os.path.exists(detection.heatmap_path):
                os.remove(detection.heatmap_path)
        except:
            pass
        db.session.delete(detection)
    
    db.session.delete(user)
    db.session.commit()
    
    log_action(current_user.id, f"Deleted user {username}", f"User ID: {user_id}")
    
    return jsonify({'message': f'User {username} deleted successfully'})

@app.route('/api/admin/users/bulk-delete', methods=['POST'])
@login_required
@admin_required
def bulk_delete_users():
    data = request.get_json()
    user_ids = data.get('user_ids', [])
    
    if not user_ids:
        return jsonify({'error': 'No user IDs provided'}), 400
    
    deleted_count = 0
    for user_id in user_ids:
        if user_id != current_user.id:
            user = db.session.get(User, user_id)
            if user:
                # Delete user's detections and files
                for detection in user.detections:
                    try:
                        if os.path.exists(detection.image_path):
                            os.remove(detection.image_path)
                        if detection.heatmap_path and os.path.exists(detection.heatmap_path):
                            os.remove(detection.heatmap_path)
                    except:
                        pass
                    db.session.delete(detection)
                db.session.delete(user)
                deleted_count += 1
    
    db.session.commit()
    
    log_action(current_user.id, f"Bulk deleted {deleted_count} users", f"User IDs: {user_ids}")
    
    return jsonify({'message': f'Successfully deleted {deleted_count} users'})

# ====== Disease Dataset Management ======

@app.route('/api/admin/diseases', methods=['GET'])
@login_required
@admin_required
def get_diseases():
    diseases = DiseaseInfo.query.all()
    
    return jsonify([{
        'id': d.id,
        'name': d.name,
        'scientific_name': d.scientific_name,
        'description': d.description,
        'symptoms': d.symptoms,
        'treatment': d.treatment,
        'prevention': d.prevention,
        'severity': d.severity,
        'created_at': d.created_at.isoformat(),
        'updated_at': d.updated_at.isoformat()
    } for d in diseases])

@app.route('/api/admin/diseases', methods=['POST'])
@login_required
@admin_required
def create_disease():
    data = request.get_json()
    
    required_fields = ['name', 'scientific_name', 'description', 'symptoms', 'treatment', 'prevention', 'severity']
    for field in required_fields:
        if field not in data:
            return jsonify({'error': f'Missing required field: {field}'}), 400
    
    disease = DiseaseInfo(
        name=data['name'],
        scientific_name=data['scientific_name'],
        description=data['description'],
        symptoms=data['symptoms'],
        treatment=data['treatment'],
        prevention=data['prevention'],
        severity=data['severity']
    )
    
    db.session.add(disease)
    db.session.commit()
    
    log_action(current_user.id, f"Created disease: {data['name']}", f"Disease ID: {disease.id}")
    
    return jsonify({'message': 'Disease created successfully', 'id': disease.id}), 201

@app.route('/api/admin/diseases/<int:disease_id>', methods=['GET', 'PUT'])
@login_required
@admin_required
def update_disease(disease_id):
    disease = DiseaseInfo.query.get_or_404(disease_id)
    if request.method == 'GET':
        return jsonify({
            'id': disease.id,
            'name': disease.name,
            'scientific_name': disease.scientific_name,
            'description': disease.description,
            'symptoms': disease.symptoms,
            'treatment': disease.treatment,
            'prevention': disease.prevention,
            'severity': disease.severity,
            'created_at': disease.created_at.isoformat(),
            'updated_at': disease.updated_at.isoformat()
        })
    data = request.get_json()
    
    for field in ['name', 'scientific_name', 'description', 'symptoms', 'treatment', 'prevention', 'severity']:
        if field in data:
            setattr(disease, field, data[field])
    
    db.session.commit()
    
    log_action(current_user.id, f"Updated disease: {disease.name}", f"Disease ID: {disease_id}")
    
    return jsonify({'message': 'Disease updated successfully'})

@app.route('/api/admin/diseases/<int:disease_id>', methods=['DELETE'])
@login_required
@admin_required
def delete_disease(disease_id):
    disease = DiseaseInfo.query.get_or_404(disease_id)
    name = disease.name
    
    db.session.delete(disease)
    db.session.commit()
    
    log_action(current_user.id, f"Deleted disease: {name}", f"Disease ID: {disease_id}")
    
    return jsonify({'message': f'Disease {name} deleted successfully'})

@app.route('/api/admin/diseases/import', methods=['POST'])
@login_required
@admin_required
def import_diseases():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not file.filename.endswith(('.csv', '.json')):
        return jsonify({'error': 'Only CSV and JSON files are supported'}), 400
    
    try:
        if file.filename.endswith('.csv'):
            df = pd.read_csv(file)
            for _, row in df.iterrows():
                disease = DiseaseInfo(
                    name=row['name'],
                    scientific_name=row.get('scientific_name', ''),
                    description=row.get('description', ''),
                    symptoms=row.get('symptoms', ''),
                    treatment=row.get('treatment', ''),
                    prevention=row.get('prevention', ''),
                    severity=row.get('severity', 'Medium')
                )
                db.session.add(disease)
        else:  # JSON
            data = json.load(file)
            for item in data:
                disease = DiseaseInfo(
                    name=item['name'],
                    scientific_name=item.get('scientific_name', ''),
                    description=item.get('description', ''),
                    symptoms=item.get('symptoms', ''),
                    treatment=item.get('treatment', ''),
                    prevention=item.get('prevention', ''),
                    severity=item.get('severity', 'Medium')
                )
                db.session.add(disease)
        
        db.session.commit()
        
        log_action(current_user.id, f"Imported diseases from {file.filename}", f"File: {file.filename}")
        
        return jsonify({'message': 'Diseases imported successfully'})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/admin/diseases/export', methods=['GET'])
@login_required
@admin_required
def export_diseases():
    format = request.args.get('format', 'json')
    diseases = DiseaseInfo.query.all()
    
    data = [{
        'name': d.name,
        'scientific_name': d.scientific_name,
        'description': d.description,
        'symptoms': d.symptoms,
        'treatment': d.treatment,
        'prevention': d.prevention,
        'severity': d.severity
    } for d in diseases]
    
    if format == 'csv':
        df = pd.DataFrame(data)
        csv_data = df.to_csv(index=False)
        return Response(csv_data, mimetype='text/csv', headers={
            'Content-Disposition': 'attachment; filename=diseases_export.csv'
        })
    else:
        return Response(
            json.dumps(data, indent=2),
            mimetype='application/json',
            headers={
                'Content-Disposition': 'attachment; filename=diseases_export.json'
            }
        )

# ====== Reports ======

@app.route('/api/admin/reports/generate', methods=['POST'])
@login_required
@admin_required
def generate_report():
    data = request.get_json() or {}
    report_type = data.get('type', 'summary')
    date_from = data.get('date_from')
    date_to = data.get('date_to')
    try:
        start_date = datetime.fromisoformat(date_from) if date_from else None
        end_date = datetime.fromisoformat(date_to) if date_to else None
    except ValueError:
        return jsonify({'error': 'Invalid report date'}), 400
    if end_date and len(date_to) == 10:
        end_date = end_date + timedelta(days=1) - timedelta(microseconds=1)
    
    # Build query filters
    filters = []
    if start_date:
        filters.append(Detection.created_at >= start_date)
    if end_date:
        filters.append(Detection.created_at <= end_date)
    
    query = Detection.query
    if filters:
        query = query.filter(*filters)
    
    detections = query.all()
    
    if report_type == 'summary':
        report = generate_summary_report(detections)
    elif report_type == 'detailed':
        report = generate_detailed_report(detections)
    elif report_type == 'disease_distribution':
        report = generate_disease_distribution_report(detections)
    elif report_type == 'user_activity':
        report = generate_user_activity_report(detections, start_date, end_date)
    else:
        return jsonify({'error': 'Invalid report type'}), 400
    
    # Save report
    report_id = str(uuid.uuid4())
    report_path = os.path.join('reports', f'report_{report_id}.json')
    os.makedirs('reports', exist_ok=True)
    
    with open(report_path, 'w') as f:
        json.dump({
            'report_id': report_id,
            'type': report_type,
            'generated_at': datetime.utcnow().isoformat(),
            'date_from': date_from,
            'date_to': date_to,
            'generated_by': current_user.username,
            'data': report
        }, f, indent=2)
    
    log_action(current_user.id, f"Generated {report_type} report", f"Report ID: {report_id}")
    
    return jsonify({
        'report_id': report_id,
        'report_type': report_type,
        'generated_at': datetime.utcnow().isoformat(),
        'date_from': date_from,
        'date_to': date_to,
        'data': report
    })

@app.route('/api/admin/reports/download/<report_id>', methods=['GET'])
@login_required
@admin_required
def download_report(report_id):
    format = request.args.get('format', 'pdf')
    report_path = os.path.join('reports', f'report_{report_id}.json')
    
    if not os.path.exists(report_path):
        return jsonify({'error': 'Report not found'}), 404
    
    with open(report_path, 'r') as f:
        report_data = json.load(f)
    
    if format == 'pdf':
        return generate_pdf_report(report_data)
    elif format == 'csv':
        return generate_csv_report(report_data)
    else:
        return jsonify(report_data)

@app.route('/api/admin/reports/<report_id>', methods=['GET'])
@login_required
@admin_required
def view_report(report_id):
    report_path = os.path.join('reports', f'report_{report_id}.json')
    if not os.path.exists(report_path):
        return jsonify({'error': 'Report not found'}), 404
    with open(report_path, 'r') as f:
        return jsonify(json.load(f))

@app.route('/api/admin/reports/<report_id>', methods=['DELETE'])
@login_required
@admin_required
def delete_report(report_id):
    report_path = os.path.join('reports', f'report_{report_id}.json')
    if not os.path.exists(report_path):
        return jsonify({'error': 'Report not found'}), 404
    os.remove(report_path)
    log_action(current_user.id, 'Deleted generated report', f'Report ID: {report_id}')
    return jsonify({'message': 'Report deleted successfully.'})

@app.route('/api/admin/reports/list', methods=['GET'])
@login_required
@admin_required
def list_reports():
    reports_dir = 'reports'
    if not os.path.exists(reports_dir):
        return jsonify([])
    
    reports = []
    for filename in os.listdir(reports_dir):
        if filename.endswith('.json'):
            with open(os.path.join(reports_dir, filename), 'r') as f:
                data = json.load(f)
                reports.append({
                    'id': data['report_id'],
                    'type': data['type'],
            'generated_at': data['generated_at'],
            'date_from': data.get('date_from'),
            'date_to': data.get('date_to'),
            'generated_by': data.get('generated_by', 'Admin')
                })
    
    return jsonify(reports)

# ====== System Statistics ======

@app.route('/api/admin/stats', methods=['GET'])
@login_required
@admin_required
def get_stats():
    total_users = User.query.count()
    active_users = User.query.filter_by(is_active=True).count()
    total_detections = Detection.query.count()
    
    # Disease distribution
    disease_stats = db.session.query(
        Detection.disease_name, 
        db.func.count(Detection.id),
        db.func.avg(Detection.confidence)
    ).group_by(Detection.disease_name).all()
    
    # User activity
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    active_detections = Detection.query.filter(Detection.created_at >= thirty_days_ago).count()
    
    # Daily statistics for the last 7 days
    daily_stats = []
    for i in range(7):
        date = datetime.utcnow().date() - timedelta(days=i)
        start = datetime.combine(date, datetime.min.time())
        end = datetime.combine(date, datetime.max.time())
        count = Detection.query.filter(Detection.created_at.between(start, end)).count()
        daily_stats.append({
            'date': date.isoformat(),
            'count': count
        })
    
    return jsonify({
        'total_users': total_users,
        'active_users': active_users,
        'total_detections': total_detections,
        'active_detections_30days': active_detections,
        'disease_distribution': [{
            'name': d[0] if d[0] else 'Unknown',
            'count': d[1],
            'avg_confidence': float(d[2]) if d[2] else 0
        } for d in disease_stats],
        'daily_stats': daily_stats,
        'model_info': {
            'version': '1.0',
            'accuracy': 0.95,
            'last_trained': '2024-01-01'
        }
    })

@app.route('/api/admin/detections', methods=['GET'])
@login_required
@admin_required
def get_all_detections():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    detections = Detection.query.order_by(Detection.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )

    return jsonify({
        'detections': [{
            'id': d.id,
            'user': db.session.get(User, d.user_id).username if d.user_id and db.session.get(User, d.user_id) else 'Unknown',
            'disease_name': d.disease_name,
            'confidence': round(float(d.confidence) * 100, 2),
            'image_url': f'/uploads/{os.path.basename(d.image_path)}',
            'heatmap_url': f'/uploads/{os.path.basename(d.heatmap_path)}' if d.heatmap_path else None,
            'date': d.created_at.strftime('%Y-%m-%d %H:%M:%S')
        } for d in detections.items],
        'total': detections.total,
        'page': page,
        'per_page': per_page,
        'pages': detections.pages
    })

# ====== System Logs ======

@app.route('/api/admin/logs', methods=['GET'])
@login_required
@admin_required
def get_logs():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    
    logs = SystemLog.query.order_by(SystemLog.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    
    return jsonify({
        'logs': [{
            'id': l.id,
            'user': db.session.get(User, l.user_id).username if l.user_id and db.session.get(User, l.user_id) else 'System',
            'action': l.action,
            'details': l.details,
            'ip_address': l.ip_address,
            'created_at': l.created_at.isoformat()
        } for l in logs.items],
        'total': logs.total,
        'page': page,
        'per_page': per_page,
        'pages': logs.pages
    })

# ====== Notification Routes ======

@app.route('/api/admin/notifications', methods=['GET'])
@login_required
@admin_required
def get_notifications():
    notifications = Notification.query.filter_by(
        recipient_id=current_user.id
    ).order_by(Notification.created_at.desc()).limit(50).all()

    return jsonify({
        'notifications': [{
            'id': notification.id,
            'notification_type': notification.notification_type,
            'message': notification.message,
            'related_user_id': notification.related_user_id,
            'is_read': notification.is_read,
            'created_at': notification.created_at.isoformat()
        } for notification in notifications],
        'unread_count': Notification.query.filter_by(
            recipient_id=current_user.id,
            is_read=False
        ).count()
    })

@app.route('/api/admin/notifications/<int:notification_id>/read', methods=['PUT'])
@login_required
@admin_required
def mark_notification_read(notification_id):
    notification = Notification.query.filter_by(
        id=notification_id,
        recipient_id=current_user.id
    ).first_or_404()
    notification.is_read = True
    db.session.commit()
    return jsonify({'message': 'Notification marked as read'})

@app.route('/api/admin/notifications/read-all', methods=['PUT'])
@login_required
@admin_required
def mark_all_notifications_read():
    Notification.query.filter_by(
        recipient_id=current_user.id,
        is_read=False
    ).update({'is_read': True})
    db.session.commit()
    return jsonify({'message': 'All notifications marked as read'})

# ====== Helper Functions ======

def log_action(user_id, action, details=None):
    log = SystemLog(
        user_id=user_id,
        action=action,
        details=details,
        ip_address=request.remote_addr
    )
    db.session.add(log)
    db.session.commit()

def notify_admins(notification_type, message, related_user_id=None):
    admin_ids = [user.id for user in User.query.filter_by(is_admin=True).all()]
    for admin_id in admin_ids:
        db.session.add(Notification(
            recipient_id=admin_id,
            notification_type=notification_type,
            message=message,
            related_user_id=related_user_id
        ))
    if admin_ids:
        db.session.commit()

def generate_summary_report(detections):
    total = len(detections)
    diseases = {}
    for d in detections:
        diseases[d.disease_name] = diseases.get(d.disease_name, 0) + 1
    
    user_detection_counts = {}
    for detection in detections:
        user = db.session.get(User, detection.user_id)
        if user:
            user_detection_counts[user.username] = user_detection_counts.get(user.username, 0) + 1

    recent_activity = SystemLog.query.order_by(SystemLog.created_at.desc()).limit(10).all()
    return {
        'type': 'summary',
        'total_users': User.query.count(),
        'total_farmers': User.query.filter_by(is_admin=False).count(),
        'total_admins': User.query.filter_by(is_admin=True).count(),
        'total_diseases': DiseaseInfo.query.count(),
        'total_detections': total,
        'successful_detections': total,
        'failed_detections': 0,
        'unique_diseases': len(diseases),
        'disease_distribution': diseases,
        'most_common_disease': max(diseases, key=diseases.get) if diseases else None,
        'most_active_user': max(user_detection_counts, key=user_detection_counts.get) if user_detection_counts else None,
        'avg_confidence': sum(d.confidence for d in detections) / total if total > 0 else 0,
        'recent_activity': [{
            'user': db.session.get(User, log.user_id).username if log.user_id and db.session.get(User, log.user_id) else 'System',
            'activity': log.action,
            'created_at': log.created_at.isoformat()
        } for log in recent_activity],
        'date_range': {
            'from': min(d.created_at.isoformat() for d in detections) if detections else None,
            'to': max(d.created_at.isoformat() for d in detections) if detections else None
        }
    }

def generate_detailed_report(detections):
    return {
        'type': 'detailed',
        'detections': [{
            'id': d.id,
            'disease_name': d.disease_name,
            'confidence': d.confidence,
            'user': db.session.get(User, d.user_id).username if d.user_id and db.session.get(User, d.user_id) else 'Unknown',
            'user_email': db.session.get(User, d.user_id).email if d.user_id and db.session.get(User, d.user_id) else 'Unknown',
            'image_url': f'/uploads/{os.path.basename(d.image_path)}' if d.image_path else None,
            'treatment': parse_treatment_value(d.treatment),
            'created_at': d.created_at.isoformat(),
            'result': d.disease_name
        } for d in detections],
        'users': [{
            'username': user.username,
            'email': user.email,
            'role': 'Admin' if user.is_admin else 'Farmer',
            'created_at': user.created_at.isoformat(),
            'last_login': user.last_login.isoformat() if user.last_login else None,
            'is_active': user.is_active
        } for user in User.query.order_by(User.created_at.desc()).all()],
        'total': len(detections)
    }

def generate_disease_distribution_report(detections):
    diseases = {}
    for d in detections:
        if d.disease_name not in diseases:
            diseases[d.disease_name] = {
                'count': 0,
                'avg_confidence': 0,
                'total_confidence': 0
            }
        diseases[d.disease_name]['count'] += 1
        diseases[d.disease_name]['total_confidence'] += d.confidence
    
    for disease in diseases:
        diseases[disease]['avg_confidence'] = diseases[disease]['total_confidence'] / diseases[disease]['count']

    total = len(detections)
    for disease in diseases.values():
        disease['percentage'] = (disease['count'] / total * 100) if total else 0

    dates = [d.created_at for d in detections]

    return {
        'type': 'disease_distribution',
        'diseases': diseases,
        'total_detections': total,
        'most_detected': max(diseases, key=lambda name: diseases[name]['count']) if diseases else None,
        'least_detected': min(diseases, key=lambda name: diseases[name]['count']) if diseases else None,
        'date_range': {
            'from': min(dates).isoformat() if dates else None,
            'to': max(dates).isoformat() if dates else None
        }
    }

def generate_user_activity_report(detections, date_from=None, date_to=None):
    users = {}
    logs_query = SystemLog.query
    if date_from:
        logs_query = logs_query.filter(SystemLog.created_at >= date_from)
    if date_to:
        logs_query = logs_query.filter(SystemLog.created_at <= date_to)
    logs = logs_query.order_by(SystemLog.created_at.desc()).all()

    for user in User.query.order_by(User.created_at.desc()).all():
        user_detections = [d for d in detections if d.user_id == user.id]
        user_logs = [log for log in logs if log.user_id == user.id]
        if user_detections or user_logs:
            users[user.username] = {
                'email': user.email,
                'role': 'Admin' if user.is_admin else 'Farmer',
                'registration_time': user.created_at.isoformat(),
                'login_time': user.last_login.isoformat() if user.last_login else None,
                'last_active_time': user_logs[0].created_at.isoformat() if user_logs else user.last_login.isoformat() if user.last_login else None,
                'login_count': sum('logged in' in log.action.lower() for log in user_logs),
                'detection_count': len(user_detections),
                'most_recent_activity': user_logs[0].action if user_logs else 'Disease detected' if user_detections else 'Registered'
            }

    return {
        'type': 'user_activity',
        'users': users,
        'activities': [{
            'user': db.session.get(User, log.user_id).username if log.user_id and db.session.get(User, log.user_id) else 'System',
            'activity': log.action,
            'details': log.details,
            'created_at': log.created_at.isoformat()
        } for log in logs],
        'total_detections': len(detections),
        'total_activities': len(logs)
    }

def generate_pdf_report(report_data):
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
    except ModuleNotFoundError:
        return jsonify({
            'error': 'PDF export requires the ReportLab package. Run: backend\\venv\\Scripts\\python.exe -m pip install -r backend\\requirements.txt'
        }), 500

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []
    
    # Title
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        spaceAfter=30
    )
    story.append(Paragraph(f"CocoDetect AI Report - {report_data['type'].title()}", title_style))
    story.append(Spacer(1, 12))
    
    # Meta info
    story.append(Paragraph(f"Generated: {report_data['generated_at']}", styles['Normal']))
    story.append(Spacer(1, 12))
    
    # Data
    data = report_data['data']
    if report_data['type'] == 'summary':
        story.append(Paragraph("Summary Statistics", styles['Heading2']))
        story.append(Spacer(1, 12))
        
        table_data = [
            ['Metric', 'Value'],
            ['Total Detections', str(data['total_detections'])],
            ['Unique Diseases', str(data['unique_diseases'])],
            ['Most Common Disease', data['most_common_disease'] or 'N/A'],
            ['Average Confidence', f"{data['avg_confidence']:.2%}"]
        ]
        
        table = Table(table_data, colWidths=[2*inch, 2*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 14),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black)
        ]))
        story.append(table)
    
    if report_data['type'] != 'summary':
        if report_data['type'] == 'detailed':
            table_data = [['ID', 'User', 'Disease', 'Confidence', 'Date']]
            table_data.extend([
                [str(item['id']), item.get('user', 'Unknown'), item.get('disease_name', 'Unknown'),
                 f"{item.get('confidence', 0):.2%}", item.get('created_at', '')]
                for item in data.get('detections', [])
            ])
        elif report_data['type'] == 'disease_distribution':
            table_data = [['Disease', 'Detections', 'Percentage', 'Avg Confidence']]
            table_data.extend([
                [name, str(info['count']), f"{info.get('percentage', 0):.2f}%", f"{info.get('avg_confidence', 0):.2%}"]
                for name, info in data.get('diseases', {}).items()
            ])
        else:
            table_data = [['User', 'Role', 'Logins', 'Detections', 'Last Activity']]
            table_data.extend([
                [name, info.get('role', ''), str(info.get('login_count', 0)),
                 str(info.get('detection_count', 0)), info.get('last_active_time') or 'N/A']
                for name, info in data.get('users', {}).items()
            ])
        if len(table_data) > 1:
            story.append(Paragraph('Report Details', styles['Heading2']))
            story.append(Table(table_data, repeatRows=1))

    doc.build(story)
    buffer.seek(0)
    
    return send_file(
        buffer,
        mimetype='application/pdf',
        as_attachment=True,
        download_name=f'report_{report_data["report_id"]}.pdf'
    )

def generate_csv_report(report_data):
    data = report_data['data']
    
    if report_data['type'] == 'detailed':
        df = pd.DataFrame(data['detections'])
    elif report_data['type'] == 'disease_distribution':
        df = pd.DataFrame([{
            'Disease': name,
            'Detections': info['count'],
            'Percentage': info.get('percentage', 0),
            'Average Confidence': info.get('avg_confidence', 0)
        } for name, info in data.get('diseases', {}).items()])
    elif report_data['type'] == 'user_activity':
        df = pd.DataFrame([{
            'User': username,
            'Email': info.get('email'),
            'Role': info.get('role'),
            'Logins': info.get('login_count', 0),
            'Detections': info.get('detection_count', 0),
            'Last Active': info.get('last_active_time'),
            'Recent Activity': info.get('most_recent_activity')
        } for username, info in data.get('users', {}).items()])
    else:
        df = pd.DataFrame([
            {'Metric': key.replace('_', ' ').title(), 'Value': value}
            for key, value in data.items()
            if not isinstance(value, (dict, list))
        ])
    
    csv_data = df.to_csv(index=False)
    return Response(csv_data, mimetype='text/csv', headers={
        'Content-Disposition': f'attachment; filename=report_{report_data["report_id"]}.csv'
    })

# ==================== MAIN ROUTES ====================

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/login')
def login_page():
    return send_from_directory(app.static_folder, 'login.html')

@app.route('/admin-login')
def admin_login_page():
    return send_from_directory(app.static_folder, 'admin-login.html')

@app.route('/register')
def register_page():
    return send_from_directory(app.static_folder, 'register.html')

@app.route('/dashboard')
@login_required
def dashboard():
    if current_user.is_admin:
        return redirect('/admin')
    return send_from_directory(app.static_folder, 'dashboard.html')

@app.route('/detect')
@login_required
def detect_page():
    if current_user.is_admin:
        return redirect('/admin')
    return send_from_directory(app.static_folder, 'detect.html')

@app.route('/history')
@login_required
def history_page():
    if current_user.is_admin:
        return redirect('/admin')
    return send_from_directory(app.static_folder, 'history.html')

@app.route('/admin')
@login_required
def admin_page():
    if not current_user.is_admin:
        return redirect('/dashboard')
    return send_from_directory(app.static_folder, 'admin.html')

@app.route('/profile')
@login_required
def profile_page():
    return send_from_directory(app.static_folder, 'profile.html')

# ==================== API ROUTES ====================

@app.route('/api/profile', methods=['GET'])
@login_required
def get_profile():
    india_timezone = ZoneInfo('Asia/Kolkata')

    def format_account_time(value):
        if value is None:
            return None
        # Database timestamps are UTC but SQLite stores them without an offset.
        return value.replace(tzinfo=timezone.utc).astimezone(india_timezone).isoformat()

    return jsonify({
        'user_id': current_user.id,
        'username': current_user.username,
        'email': current_user.email,
        'role': 'Administrator' if current_user.is_admin else 'Farmer',
        'phone': None,
        'profile_photo': None,
        'created_at': format_account_time(current_user.created_at),
        'last_login': format_account_time(current_user.last_login)
    })

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    email = data.get('email')
    password = data.get('password')
    confirm_password = data.get('confirm_password')

    if not all([username, email, password, confirm_password]):
        return jsonify({'error': 'All fields are required'}), 400

    if password != confirm_password:
        return jsonify({'error': 'Passwords do not match'}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered'}), 400

    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    user = User(username=username, email=email, password_hash=hashed_password)
    db.session.add(user)
    db.session.commit()

    log_action(user.id, "User registered", f"Username: {username}")
    notify_admins(
        'user_registration',
        f'New farmer account created: {user.username} ({user.email})',
        user.id
    )
    
    return jsonify({'message': 'Registration successful', 'user_id': user.id}), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    user = User.query.filter_by(username=username).first()
    if not user or not bcrypt.check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Invalid username or password'}), 401

    if not user.is_active:
        return jsonify({'error': 'Account is deactivated'}), 403

    login_user(user)
    user.last_login = datetime.utcnow()
    db.session.commit()

    log_action(user.id, "User logged in", f"Username: {username}")
    notify_admins(
        'user_login',
        f'{user.username} logged into the system.',
        user.id
    )
    
    return jsonify({
        'message': 'Login successful',
        'user_id': user.id,
        'username': user.username,
        'is_admin': user.is_admin
    }), 200

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    user = User.query.filter_by(username=username).first()
    if not user or not bcrypt.check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Invalid admin username or password'}), 401

    if not user.is_active:
        return jsonify({'error': 'Account is deactivated'}), 403

    if not user.is_admin:
        return jsonify({'error': 'This account does not have admin access'}), 403

    login_user(user)
    user.last_login = datetime.utcnow()
    db.session.commit()

    log_action(user.id, "Admin logged in", f"Username: {username}")
    notify_admins(
        'admin_login',
        f'Admin {user.username} logged into the system.',
        user.id
    )

    return jsonify({
        'message': 'Admin login successful',
        'user_id': user.id,
        'username': user.username,
        'is_admin': True
    }), 200

@app.route('/api/logout', methods=['POST'])
@login_required
def logout():
    log_action(current_user.id, "User logged out", f"Username: {current_user.username}")
    logout_user()
    return jsonify({'message': 'Logged out successfully'}), 200

@app.route('/api/detect', methods=['POST'])
@login_required
def detect():
    if 'image' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'No image selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type'}), 400

    try:
        # Save uploaded file
        filename = f"{uuid.uuid4()}_{secure_filename(file.filename)}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        file.save(filepath)

        # Process image
        processed_image = image_processor.process_image(filepath)
        
        # Predict disease
        prediction = disease_model.predict(processed_image)
        disease_name = prediction['disease_name']
        confidence = prediction['confidence']

        # Generate Grad-CAM heatmap
        heatmap_filename = f"heatmap_{filename}"
        heatmap_path = os.path.join(app.config['UPLOAD_FOLDER'], heatmap_filename)
        grad_cam.generate_heatmap(processed_image, disease_name, heatmap_path)

        # Get treatment recommendation
        treatment = get_treatment_recommendation(disease_name)

        # Save detection to database
        detection = Detection(
            user_id=current_user.id,
            image_path=filepath,
            disease_name=disease_name,
            confidence=confidence,
            heatmap_path=heatmap_path,
            treatment=json.dumps(treatment) if treatment else None
        )
        db.session.add(detection)
        db.session.commit()

        log_action(current_user.id, "Disease detected", f"Disease: {disease_name}, Confidence: {confidence:.2f}")

        return jsonify({
            'disease_name': disease_name,
            'confidence': round(float(confidence) * 100, 2),
            'heatmap_url': f'/uploads/{heatmap_filename}',
            'image_url': f'/uploads/{filename}',
            'treatment': treatment,
            'detection_id': detection.id
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/detections', methods=['GET'])
@login_required
def get_detections():
    detections = Detection.query.filter_by(user_id=current_user.id).order_by(Detection.created_at.desc()).all()
    return jsonify([{
        'id': d.id,
        'disease_name': d.disease_name,
        'confidence': round(float(d.confidence) * 100, 2),
        'image_url': f'/uploads/{os.path.basename(d.image_path)}',
        'heatmap_url': f'/uploads/{os.path.basename(d.heatmap_path)}' if d.heatmap_path else None,
        'treatment': parse_treatment_value(d.treatment),
        'date': d.created_at.strftime('%Y-%m-%d %H:%M:%S')
    } for d in detections]), 200

@app.route('/api/detection/<int:detection_id>', methods=['DELETE'])
@login_required
def delete_detection(detection_id):
    detection = Detection.query.get_or_404(detection_id)
    if detection.user_id != current_user.id and not current_user.is_admin:
        return jsonify({'error': 'Unauthorized'}), 403
    
    # Delete files
    try:
        if os.path.exists(detection.image_path):
            os.remove(detection.image_path)
        if detection.heatmap_path and os.path.exists(detection.heatmap_path):
            os.remove(detection.heatmap_path)
    except:
        pass
    
    db.session.delete(detection)
    db.session.commit()
    return jsonify({'message': 'Detection deleted successfully'}), 200

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

def get_treatment_recommendation(disease_name):
    # This will be replaced with database lookups in production
    treatments = {
        'Bud Root Dropping': {
            'treatment': 'Apply Bordeaux mixture (1%) or Copper oxychloride. Remove and destroy infected plant parts. Improve drainage.',
            'prevention': 'Maintain proper spacing, avoid waterlogging, apply fungicides regularly.',
            'fertilizer': 'Apply organic manure (10kg/plant) and NPK 17:17:17 (200g/plant)'
        },
        'Bud Root': {
            'treatment': 'Apply fungicides like Mancozeb or Copper-based fungicides. Remove affected tissues.',
            'prevention': 'Ensure good air circulation, avoid overhead irrigation, maintain proper sanitation.',
            'fertilizer': 'Apply balanced NPK fertilizer and organic compost'
        },
        'Gray Leaf Spot': {
            'treatment': 'Spray fungicides like Chlorothalonil or Mancozeb. Remove infected leaves.',
            'prevention': 'Maintain proper spacing, avoid wet conditions, apply preventive fungicides.',
            'fertilizer': 'Apply Potassium-rich fertilizer (K2O 20%) and organic matter'
        },
        'Leaf Rot': {
            'treatment': 'Apply systemic fungicides. Prune and destroy severely affected leaves.',
            'prevention': 'Ensure proper drainage, avoid overcrowding, maintain field hygiene.',
            'fertilizer': 'Apply balanced NPK with micronutrients (Zinc, Copper)'
        },
        'Stem Bleeding': {
            'treatment': 'Remove infected bark and apply fungicide paste (Bordeaux paste). Improve soil drainage.',
            'prevention': 'Avoid injuries to stem, maintain proper soil pH, apply Trichoderma.',
            'fertilizer': 'Apply micronutrients (Zinc, Copper, Manganese) and organic matter'
        },
        'Healthy': {
            'treatment': 'Plant is healthy. Continue good agricultural practices.',
            'prevention': 'Regular monitoring, proper irrigation, balanced fertilization.',
            'fertilizer': 'Apply balanced NPK (17:17:17) and organic manure as per schedule'
        }
    }
    return treatments.get(disease_name, treatments['Healthy'])


def migrate_database():
    """Apply additive schema updates required by the current application."""
    if db.engine.url.drivername != 'sqlite':
        return

    columns = {
        column[1]
        for column in db.session.execute(text('PRAGMA table_info("user")'))
    }
    required_columns = {
        'is_active': 'BOOLEAN NOT NULL DEFAULT 1',
        'last_login': 'DATETIME'
    }
    for column_name, column_type in required_columns.items():
        if column_name not in columns:
            db.session.execute(
                text(f'ALTER TABLE "user" ADD COLUMN {column_name} {column_type}')
            )
            print(f'Database migrated: added user.{column_name}')

    db.session.commit()

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        migrate_database()
        # Create admin user if not exists
        if not User.query.filter_by(username='admin').first():
            admin_user = User(
                username='admin',
                email='admin@coconutdetection.com',
                password_hash=bcrypt.generate_password_hash('admin123').decode('utf-8'),
                is_admin=True
            )
            db.session.add(admin_user)
            db.session.commit()
            print('✅ Admin user created: username=admin, password=admin123')
        
        # Add default disease information if not exists
        default_diseases = [
            {
                'name': 'Bud Root Dropping',
                'scientific_name': 'Phytophthora palmivora',
                'description': 'A fungal disease affecting the growing bud of coconut palms.',
                'symptoms': 'Yellowing and drooping of leaves, rotting of the bud, foul smell.',
                'treatment': 'Apply Bordeaux mixture (1%) or Copper oxychloride. Remove and destroy infected plant parts.',
                'prevention': 'Maintain proper spacing, avoid waterlogging, apply fungicides regularly.',
                'severity': 'High'
            },
            {
                'name': 'Bud Root',
                'scientific_name': 'Phytophthora spp.',
                'description': 'Disease affecting the bud and root system of coconut palms.',
                'symptoms': 'Leaf yellowing, stunted growth, root rot, bud decay.',
                'treatment': 'Apply fungicides like Mancozeb or Copper-based fungicides.',
                'prevention': 'Ensure good air circulation, avoid overhead irrigation.',
                'severity': 'Medium'
            },
            {
                'name': 'Gray Leaf Spot',
                'scientific_name': 'Pestalotiopsis palmarum',
                'description': 'Fungal disease causing gray spots on coconut leaves.',
                'symptoms': 'Gray to brown spots on leaves, yellow halos around spots, leaf drying.',
                'treatment': 'Spray fungicides like Chlorothalonil or Mancozeb.',
                'prevention': 'Maintain proper spacing, avoid wet conditions.',
                'severity': 'Medium'
            },
            {
                'name': 'Leaf Rot',
                'scientific_name': 'Bipolaris incurvata',
                'description': 'Fungal disease causing leaf rot and blight.',
                'symptoms': 'Brown to black lesions on leaves, leaf blight, premature leaf drop.',
                'treatment': 'Apply systemic fungicides. Prune and destroy affected leaves.',
                'prevention': 'Ensure proper drainage, avoid overcrowding.',
                'severity': 'High'
            },
            {
                'name': 'Stem Bleeding',
                'scientific_name': 'Ceratocystis paradoxa',
                'description': 'Fungal disease causing stem bleeding and death of palms.',
                'symptoms': 'Reddish gum exudation from stem, internal stem rot, leaf yellowing.',
                'treatment': 'Remove infected bark and apply fungicide paste.',
                'prevention': 'Avoid injuries to stem, maintain proper soil pH.',
                'severity': 'Critical'
            },
            {
                'name': 'Healthy',
                'scientific_name': 'N/A',
                'description': 'Plant is healthy with no disease symptoms.',
                'symptoms': 'No symptoms present. Plant is thriving.',
                'treatment': 'Continue good agricultural practices.',
                'prevention': 'Regular monitoring, proper irrigation, balanced fertilization.',
                'severity': 'Low'
            }
        ]
        
        for disease_data in default_diseases:
            if not DiseaseInfo.query.filter_by(name=disease_data['name']).first():
                disease = DiseaseInfo(**disease_data)
                db.session.add(disease)
        
        db.session.commit()
        print('✅ Default disease information added')
    
    app.run(debug=True, host='0.0.0.0', port=5000)
