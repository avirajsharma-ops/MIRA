#!/bin/bash
# ===========================================
# MIRA AI Assistant - Production Deployment
# Single script for complete server setup
# ===========================================

set -e

# Configuration
DOMAIN="itsmira.cloud"
EMAIL="avi2001raj@gmail.com"
APP_DIR="/var/www/mira"
BACKUP_DIR="/var/www/mira-backups"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                                                           ║"
    echo "║     ███╗   ███╗██╗██████╗  █████╗                        ║"
    echo "║     ████╗ ████║██║██╔══██╗██╔══██╗                       ║"
    echo "║     ██╔████╔██║██║██████╔╝███████║                       ║"
    echo "║     ██║╚██╔╝██║██║██╔══██╗██╔══██║                       ║"
    echo "║     ██║ ╚═╝ ██║██║██║  ██║██║  ██║                       ║"
    echo "║     ╚═╝     ╚═╝╚═╝╚═╝  ╚═╝╚═╝  ╚═╝                       ║"
    echo "║                                                           ║"
    echo "║         Production Deployment Script v1.0                 ║"
    echo "║         Domain: ${DOMAIN}                          ║"
    echo "║                                                           ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_status() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error() { echo -e "${RED}[✗]${NC} $1"; }
print_info() { echo -e "${BLUE}[i]${NC} $1"; }
print_step() { echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"; }

# Parse arguments
FRESH_INSTALL=false
SETUP_SSL=false
SKIP_DEPS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --fresh) FRESH_INSTALL=true; shift ;;
        --ssl) SETUP_SSL=true; shift ;;
        --skip-deps) SKIP_DEPS=true; shift ;;
        --help) 
            echo "Usage: ./deploy-production.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --fresh      Fresh installation (install all dependencies)"
            echo "  --ssl        Setup SSL certificates with Let's Encrypt"
            echo "  --skip-deps  Skip dependency installation"
            echo "  --help       Show this help message"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Update system packages
update_system() {
    print_step "Step 1: Updating System Packages"
    apt-get update -y
    apt-get upgrade -y
    apt-get install -y curl wget git nano ufw software-properties-common \
        apt-transport-https ca-certificates gnupg lsb-release
    print_status "System packages updated"
}

# Install Docker
install_docker() {
    print_step "Step 2: Installing Docker"
    
    if command -v docker &> /dev/null; then
        print_warning "Docker already installed, skipping..."
        docker --version
    else
        # Remove old versions
        apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
        
        # Add Docker GPG key
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        chmod a+r /etc/apt/keyrings/docker.gpg
        
        # Add Docker repository
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
        
        # Install Docker
        apt-get update -y
        apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        
        # Start and enable Docker
        systemctl start docker
        systemctl enable docker
        
        print_status "Docker installed successfully"
        docker --version
    fi
}

# Install Docker Compose (standalone)
install_docker_compose() {
    print_step "Step 3: Verifying Docker Compose"
    
    if docker compose version &> /dev/null; then
        print_status "Docker Compose plugin available"
        docker compose version
    else
        print_error "Docker Compose plugin not found"
        exit 1
    fi
}

# Configure firewall
configure_firewall() {
    print_step "Step 4: Configuring Firewall"
    
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp    # SSH
    ufw allow 80/tcp    # HTTP
    ufw allow 443/tcp   # HTTPS
    ufw --force enable
    
    print_status "Firewall configured (ports 22, 80, 443 open)"
    ufw status
}

# Install Certbot and get SSL certificate
setup_ssl() {
    print_step "Step 5: Setting Up SSL Certificate"
    
    # Install certbot
    apt-get install -y certbot
    
    # Stop any running containers that might be using port 80
    docker compose down 2>/dev/null || true
    
    # Get certificate using standalone mode
    print_info "Requesting SSL certificate for ${DOMAIN}..."
    
    certbot certonly --standalone \
        --non-interactive \
        --agree-tos \
        --email ${EMAIL} \
        --domains ${DOMAIN} \
        --preferred-challenges http
    
    if [ $? -eq 0 ]; then
        print_status "SSL certificate obtained successfully"
        
        # Create SSL directory for nginx
        mkdir -p ${APP_DIR}/ssl
        
        # Copy certificates
        cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ${APP_DIR}/ssl/
        cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem ${APP_DIR}/ssl/
        chmod 600 ${APP_DIR}/ssl/*.pem
        
        print_status "SSL certificates copied to ${APP_DIR}/ssl/"
    else
        print_error "Failed to obtain SSL certificate"
        print_warning "Continuing without SSL..."
    fi
    
    # Setup auto-renewal cron job
    (crontab -l 2>/dev/null | grep -v certbot; echo "0 3 * * * certbot renew --quiet --post-hook 'cp /etc/letsencrypt/live/${DOMAIN}/*.pem ${APP_DIR}/ssl/ && docker compose -f ${APP_DIR}/docker-compose.yml restart nginx'") | crontab -
    print_status "SSL auto-renewal configured"
}

# Create nginx configuration with SSL
create_nginx_config() {
    print_step "Step 6: Creating Nginx Configuration"
    
    mkdir -p ${APP_DIR}/nginx
    
    # Check if SSL certificates exist
    if [ -f "${APP_DIR}/ssl/fullchain.pem" ]; then
        print_info "Creating Nginx config with SSL..."
        cat > ${APP_DIR}/nginx/nginx.conf << 'NGINXEOF'
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log warn;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=general:10m rate=30r/s;

    # Upstream
    upstream mira_app {
        server mira:3000;
        keepalive 32;
    }

    # HTTP - Redirect to HTTPS
    server {
        listen 80;
        server_name itsmira.cloud;
        
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        
        location / {
            return 301 https://$server_name$request_uri;
        }
    }

    # HTTPS
    server {
        listen 443 ssl http2;
        server_name itsmira.cloud;

        # SSL Configuration
        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;
        ssl_session_timeout 1d;
        ssl_session_cache shared:SSL:50m;
        ssl_session_tickets off;

        # Modern SSL configuration
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;

        # HSTS
        add_header Strict-Transport-Security "max-age=63072000" always;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;

        # Client body size for file uploads
        client_max_body_size 50M;

        # API routes with rate limiting
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://mira_app;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 300s;
            proxy_connect_timeout 75s;
        }

        # General routes
        location / {
            limit_req zone=general burst=50 nodelay;
            proxy_pass http://mira_app;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }

        # Health check endpoint
        location /api/health {
            proxy_pass http://mira_app;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            access_log off;
        }
    }
}
NGINXEOF
    else
        print_info "Creating Nginx config without SSL (HTTP only)..."
        cat > ${APP_DIR}/nginx/nginx.conf << 'NGINXEOF'
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent"';
    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log warn;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml;

    upstream mira_app {
        server mira:3000;
        keepalive 32;
    }

    server {
        listen 80;
        server_name itsmira.cloud;

        client_max_body_size 50M;

        location / {
            proxy_pass http://mira_app;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
NGINXEOF
    fi
    
    print_status "Nginx configuration created"
}

# Create docker-compose for production
create_docker_compose() {
    print_step "Step 7: Creating Docker Compose Configuration"
    
    # Check if SSL certificates exist
    if [ -f "${APP_DIR}/ssl/fullchain.pem" ]; then
        cat > ${APP_DIR}/docker-compose.prod.yml << 'COMPOSEEOF'
services:
  mira:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: mira-app
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_APP_URL=https://itsmira.cloud
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - mira-network

  nginx:
    image: nginx:alpine
    container_name: mira-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      mira:
        condition: service_healthy
    networks:
      - mira-network

networks:
  mira-network:
    driver: bridge
COMPOSEEOF
    else
        cat > ${APP_DIR}/docker-compose.prod.yml << 'COMPOSEEOF'
services:
  mira:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: mira-app
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_APP_URL=http://itsmira.cloud
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - mira-network

  nginx:
    image: nginx:alpine
    container_name: mira-nginx
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      mira:
        condition: service_healthy
    networks:
      - mira-network

networks:
  mira-network:
    driver: bridge
COMPOSEEOF
    fi
    
    print_status "Docker Compose configuration created"
}

# Setup environment file
setup_env() {
    print_step "Step 8: Checking Environment Variables"
    
    if [ -f "${APP_DIR}/.env" ]; then
        print_status ".env file found"
    else
        print_error ".env file not found!"
        print_warning "Please create ${APP_DIR}/.env with your API keys before running this script"
        print_info "Required variables:"
        print_info "  - MONGODB_URI"
        print_info "  - OPENAI_API_KEY"
        print_info "  - GEMINI_API_KEY"
        print_info "  - ELEVENLABS_API_KEY"
        print_info "  - ELEVENLABS_VOICE_MI"
        print_info "  - ELEVENLABS_VOICE_RA"
        print_info "  - JWT_SECRET"
        print_info "  - NEXTAUTH_SECRET"
        print_info "  - NEXTAUTH_URL"
        print_info "  - NEXT_PUBLIC_APP_URL"
        exit 1
    fi
}

# Build and deploy
build_and_deploy() {
    print_step "Step 9: Building and Deploying Application"
    
    cd ${APP_DIR}
    
    # Create backup if exists
    if [ -d "${APP_DIR}/.next" ]; then
        mkdir -p ${BACKUP_DIR}
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        print_info "Creating backup..."
        tar -czf "${BACKUP_DIR}/mira_backup_${TIMESTAMP}.tar.gz" \
            --exclude='node_modules' \
            --exclude='.next' \
            --exclude='.git' \
            . 2>/dev/null || true
        # Keep only last 5 backups
        ls -t ${BACKUP_DIR}/mira_backup_*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm
    fi
    
    # Stop existing containers
    print_info "Stopping existing containers..."
    docker compose -f docker-compose.prod.yml down 2>/dev/null || true
    
    # Build fresh image
    print_info "Building Docker image (this may take a few minutes)..."
    docker compose -f docker-compose.prod.yml build --no-cache
    
    # Start containers
    print_info "Starting containers..."
    docker compose -f docker-compose.prod.yml up -d
    
    print_status "Containers started"
}

# Wait for health check
wait_for_health() {
    print_step "Step 10: Waiting for Application to Start"
    
    MAX_RETRIES=60
    RETRY_COUNT=0
    
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if docker exec mira-app curl -s http://localhost:3000/api/health | grep -q "healthy"; then
            print_status "Application is healthy!"
            break
        fi
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo -ne "\r  Waiting for application to start... (${RETRY_COUNT}/${MAX_RETRIES})"
        sleep 2
    done
    echo ""
    
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        print_error "Application failed to start within timeout"
        print_info "Checking logs..."
        docker compose -f ${APP_DIR}/docker-compose.prod.yml logs --tail=50 mira
        exit 1
    fi
}

# Cleanup
cleanup() {
    print_step "Step 11: Cleaning Up"
    
    docker image prune -f
    apt-get autoremove -y
    apt-get clean
    
    print_status "Cleanup complete"
}

# Print summary
print_summary() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║              DEPLOYMENT COMPLETE!                         ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    if [ -f "${APP_DIR}/ssl/fullchain.pem" ]; then
        echo -e "${GREEN}🌐 Your site is live at: https://${DOMAIN}${NC}"
    else
        echo -e "${YELLOW}🌐 Your site is live at: http://${DOMAIN}${NC}"
        echo -e "${YELLOW}   (SSL not configured - run with --ssl to enable)${NC}"
    fi
    
    echo ""
    echo "Useful commands:"
    echo "  View logs:        docker compose -f ${APP_DIR}/docker-compose.prod.yml logs -f"
    echo "  Restart:          docker compose -f ${APP_DIR}/docker-compose.prod.yml restart"
    echo "  Stop:             docker compose -f ${APP_DIR}/docker-compose.prod.yml down"
    echo "  Rebuild:          docker compose -f ${APP_DIR}/docker-compose.prod.yml up -d --build"
    echo ""
    echo "  Check status:     docker compose -f ${APP_DIR}/docker-compose.prod.yml ps"
    echo "  App logs:         docker logs -f mira-app"
    echo "  Nginx logs:       docker logs -f mira-nginx"
    echo ""
    
    # Show container status
    echo "Container Status:"
    docker compose -f ${APP_DIR}/docker-compose.prod.yml ps
}

# Main execution
main() {
    print_banner
    check_root
    
    # Change to app directory
    cd "$(dirname "$0")"
    APP_DIR="$(pwd)"
    
    if [ "$FRESH_INSTALL" = true ] || [ "$SKIP_DEPS" = false ]; then
        update_system
        install_docker
        install_docker_compose
        configure_firewall
    fi
    
    if [ "$SETUP_SSL" = true ]; then
        setup_ssl
    fi
    
    create_nginx_config
    create_docker_compose
    setup_env
    build_and_deploy
    wait_for_health
    cleanup
    print_summary
}

# Run main
main "$@"
