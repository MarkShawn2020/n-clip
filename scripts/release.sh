#!/bin/bash

# LovClip Release Script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 LovClip Release Script${NC}"
echo "========================================"

# Check if we're on main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${RED}❌ Error: Must be on main branch to release${NC}"
    exit 1
fi

# Check if working directory is clean
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}❌ Error: Working directory must be clean${NC}"
    exit 1
fi

# Check if we have any uncommitted changes
if [ -n "$(git diff --cached --name-only)" ]; then
    echo -e "${RED}❌ Error: You have staged changes. Please commit or stash them.${NC}"
    exit 1
fi

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${YELLOW}Current version: ${CURRENT_VERSION}${NC}"

# Ask for version type
echo "What type of release is this?"
echo "1) patch (1.0.0 -> 1.0.1)"
echo "2) minor (1.0.0 -> 1.1.0)"
echo "3) major (1.0.0 -> 2.0.0)"
echo "4) prerelease (1.0.0 -> 1.0.1-beta.0)"

read -p "Enter your choice (1-4): " VERSION_CHOICE

case $VERSION_CHOICE in
    1)
        VERSION_TYPE="patch"
        ;;
    2)
        VERSION_TYPE="minor"
        ;;
    3)
        VERSION_TYPE="major"
        ;;
    4)
        VERSION_TYPE="prerelease"
        ;;
    *)
        echo -e "${RED}❌ Invalid choice${NC}"
        exit 1
        ;;
esac

echo -e "${YELLOW}📝 Running pre-release checks...${NC}"

# Run tests
echo "Running tests..."
pnpm test

# Run TypeScript check
echo "Running TypeScript check..."
pnpm exec tsc -noEmit

# Build the project
echo "Building project..."
pnpm run build:native

echo -e "${GREEN}✅ All checks passed!${NC}"

# Bump version
echo -e "${YELLOW}📦 Bumping version...${NC}"
if [ "$VERSION_TYPE" = "prerelease" ]; then
    NEW_VERSION=$(pnpm version prerelease --preid=beta)
else
    NEW_VERSION=$(pnpm version $VERSION_TYPE)
fi

echo -e "${GREEN}✅ Version bumped to: ${NEW_VERSION}${NC}"

# Push to GitHub
echo -e "${YELLOW}🔄 Pushing to GitHub...${NC}"
git push origin main
git push origin $NEW_VERSION

echo -e "${GREEN}✅ Release ${NEW_VERSION} has been pushed to GitHub!${NC}"
echo -e "${YELLOW}📦 GitHub Actions will now build and publish the release automatically.${NC}"
echo -e "${YELLOW}🔗 Check the progress at: https://github.com/MarkShawn2020/lovclip/actions${NC}"

echo "========================================"
echo -e "${GREEN}🎉 Release process completed!${NC}"