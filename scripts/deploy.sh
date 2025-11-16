#!/bin/bash

# 🚀 Deployment Helper Script for Cloudflare Workers
# این اسکریپت به شما کمک می‌کند تا پروژه را به راحتی deploy کنید

set -e

echo "🔥 Firewall Bot - Cloudflare Worker Deployment"
echo "=============================================="
echo ""

# رنگ‌ها برای output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# تابع برای چاپ پیام‌های رنگی
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# چک کردن وجود .env
if [ ! -f .env ]; then
    print_error ".env file not found!"
    echo "Please create .env file from .env.example"
    exit 1
fi

print_success ".env file found"

# چک کردن node_modules
if [ ! -d "node_modules" ]; then
    print_warning "node_modules not found. Installing dependencies..."
    npm install
    print_success "Dependencies installed"
else
    print_success "Dependencies already installed"
fi

# چک کردن Wrangler CLI
if ! command -v wrangler &> /dev/null; then
    print_warning "Wrangler CLI not found. Installing..."
    npm install -g wrangler
    print_success "Wrangler CLI installed"
else
    print_success "Wrangler CLI found"
fi

# چک کردن لاگین Cloudflare
echo ""
echo "Checking Cloudflare authentication..."
if ! wrangler whoami &> /dev/null; then
    print_warning "Not logged in to Cloudflare. Please login..."
    wrangler login
else
    print_success "Already logged in to Cloudflare"
fi

# Generate Prisma Client
echo ""
echo "Generating Prisma Client..."
npx prisma generate
print_success "Prisma Client generated"

# Build Mini App
echo ""
echo "Building Mini App..."
npm run build

if [ -d "dist" ]; then
    print_success "Mini App built successfully"
    echo "  → Bundle size: $(du -sh dist | cut -f1)"
else
    print_error "Build failed!"
    exit 1
fi

# نمایش اطلاعات wrangler.toml
echo ""
echo "Current Wrangler Configuration:"
echo "================================"
if [ -f wrangler.toml ]; then
    grep -E "^name|^BACKEND_URL" wrangler.toml || true
fi

# سوال برای deploy
echo ""
read -p "Do you want to deploy to Cloudflare Workers now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "🚀 Deploying to Cloudflare Workers..."
    npm run worker:deploy
    
    if [ $? -eq 0 ]; then
        echo ""
        print_success "Deployment successful!"
        echo ""
        echo "📋 Next Steps:"
        echo "  1. Copy your Worker URL from the output above"
        echo "  2. Update MINI_APP_URL in your backend .env file"
        echo "  3. Restart your backend server"
        echo "  4. Set Menu Button URL in @BotFather"
        echo "  5. Test your bot with /start command"
        echo ""
        echo "📖 See DEPLOYMENT.md for detailed instructions"
    else
        print_error "Deployment failed!"
        exit 1
    fi
else
    echo ""
    print_warning "Deployment cancelled"
    echo "To deploy manually, run: npm run worker:deploy"
fi

echo ""
print_success "Done!"
