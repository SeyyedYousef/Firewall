#!/bin/bash

# 🔍 Health Check Script
# این اسکریپت وضعیت سلامت پروژه را بررسی می‌کند

set -e

# رنگ‌ها
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE} $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

ERRORS=0
WARNINGS=0

# Header
echo ""
print_header "🔥 Firewall Bot - Health Check"
echo ""

# Check .env file
print_header "📋 Configuration Files"
if [ -f ".env" ]; then
    print_success ".env file exists"
    
    # Check required variables
    if grep -q "BOT_TOKEN=" .env && ! grep -q "BOT_TOKEN=$" .env; then
        print_success "BOT_TOKEN is set"
    else
        print_error "BOT_TOKEN is not set in .env"
        ((ERRORS++))
    fi
    
    if grep -q "BOT_OWNER_ID=" .env && ! grep -q "BOT_OWNER_ID=$" .env; then
        print_success "BOT_OWNER_ID is set"
    else
        print_error "BOT_OWNER_ID is not set in .env"
        ((ERRORS++))
    fi
    
    if grep -q "DATABASE_URL=" .env && ! grep -q "DATABASE_URL=$" .env; then
        print_success "DATABASE_URL is set"
    else
        print_warning "DATABASE_URL is not set (bot will use JSON fallback)"
        ((WARNINGS++))
    fi
    
    if grep -q "MINI_APP_URL=" .env && ! grep -q "MINI_APP_URL=$" .env; then
        print_success "MINI_APP_URL is set"
    else
        print_warning "MINI_APP_URL contains default value"
        ((WARNINGS++))
    fi
else
    print_error ".env file not found"
    ((ERRORS++))
fi
echo ""

# Check dependencies
print_header "📦 Dependencies"
if [ -d "node_modules" ]; then
    print_success "node_modules directory exists"
    
    # Check package.json
    if [ -f "package.json" ]; then
        print_success "package.json exists"
    else
        print_error "package.json not found"
        ((ERRORS++))
    fi
    
    # Check critical packages
    if [ -d "node_modules/telegraf" ]; then
        print_success "telegraf installed"
    else
        print_error "telegraf not installed"
        ((ERRORS++))
    fi
    
    if [ -d "node_modules/@prisma/client" ]; then
        print_success "@prisma/client installed"
    else
        print_warning "@prisma/client not installed (run: npm install)"
        ((WARNINGS++))
    fi
else
    print_error "node_modules not found (run: npm install)"
    ((ERRORS++))
fi
echo ""

# Check Prisma
print_header "🗄️  Database"
if [ -f "prisma/schema.prisma" ]; then
    print_success "Prisma schema exists"
    
    # Check if Prisma Client is generated
    if [ -d "node_modules/.prisma/client" ]; then
        print_success "Prisma Client generated"
    else
        print_warning "Prisma Client not generated (run: npx prisma generate)"
        ((WARNINGS++))
    fi
else
    print_error "Prisma schema not found"
    ((ERRORS++))
fi
echo ""

# Check TypeScript compilation
print_header "🔧 TypeScript"
if command -v npx &> /dev/null; then
    echo "Checking TypeScript compilation..."
    if npx tsc --noEmit 2>&1 | grep -q "error TS"; then
        print_error "TypeScript compilation has errors"
        ((ERRORS++))
    else
        print_success "TypeScript compilation successful"
    fi
else
    print_warning "npx not found, skipping TypeScript check"
    ((WARNINGS++))
fi
echo ""

# Check build
print_header "🏗️  Build"
if [ -d "dist" ]; then
    print_success "dist directory exists (build completed)"
    DIST_SIZE=$(du -sh dist 2>/dev/null | cut -f1)
    echo "  └─ Bundle size: $DIST_SIZE"
else
    print_warning "dist directory not found (run: npm run build)"
    ((WARNINGS++))
fi
echo ""

# Check Worker configuration
print_header "☁️  Cloudflare Worker"
if [ -f "wrangler.toml" ]; then
    print_success "wrangler.toml exists"
    
    # Check BACKEND_URL
    if grep -q 'BACKEND_URL = "https://your' wrangler.toml; then
        print_warning "BACKEND_URL in wrangler.toml still contains default value"
        ((WARNINGS++))
    else
        print_success "BACKEND_URL configured in wrangler.toml"
    fi
else
    print_error "wrangler.toml not found"
    ((ERRORS++))
fi
echo ""

# Check worker code
if [ -f "worker/index.ts" ]; then
    print_success "Worker code exists"
else
    print_error "worker/index.ts not found"
    ((ERRORS++))
fi
echo ""

# Check bot code
print_header "🤖 Bot Files"
if [ -f "bot/index.ts" ]; then
    print_success "Bot code exists"
else
    print_error "bot/index.ts not found"
    ((ERRORS++))
fi

if [ -f "server/index.ts" ]; then
    print_success "Server code exists"
else
    print_error "server/index.ts not found"
    ((ERRORS++))
fi
echo ""

# Check frontend
print_header "📱 Frontend"
if [ -f "src/index.tsx" ]; then
    print_success "Frontend entry point exists"
else
    print_error "src/index.tsx not found"
    ((ERRORS++))
fi

if [ -f "index.html" ]; then
    print_success "index.html exists"
else
    print_error "index.html not found"
    ((ERRORS++))
fi

if [ -f "vite.config.ts" ]; then
    print_success "vite.config.ts exists"
else
    print_error "vite.config.ts not found"
    ((ERRORS++))
fi
echo ""

# Summary
print_header "📊 Summary"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}🎉 All checks passed! Your project is ready.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Run: npm run build"
    echo "  2. Run: npm run worker:deploy"
    echo "  3. Configure MINI_APP_URL in backend"
    echo "  4. Start backend: npm run bot:webhook"
    echo ""
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS warning(s) found. Review them before deployment.${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}✗ $ERRORS error(s) and $WARNINGS warning(s) found.${NC}"
    echo ""
    echo "Please fix the errors above before proceeding."
    echo ""
    exit 1
fi
