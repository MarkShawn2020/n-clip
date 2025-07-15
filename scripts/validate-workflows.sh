#!/bin/bash

# GitHub Actions Workflow Validation Script

echo "🔍 Validating GitHub Actions Workflows..."

WORKFLOWS_DIR=".github/workflows"
VALID_COUNT=0
INVALID_COUNT=0

# Check if workflows directory exists
if [ ! -d "$WORKFLOWS_DIR" ]; then
    echo "❌ Workflows directory not found: $WORKFLOWS_DIR"
    exit 1
fi

# Function to validate a single workflow file
validate_workflow() {
    local file="$1"
    local filename=$(basename "$file")
    
    echo -n "Validating $filename... "
    
    # Check YAML syntax using Python
    if python3 -c "import yaml; yaml.safe_load(open('$file'))" 2>/dev/null; then
        echo "✅ Valid"
        VALID_COUNT=$((VALID_COUNT + 1))
    else
        echo "❌ Invalid YAML syntax"
        INVALID_COUNT=$((INVALID_COUNT + 1))
        
        # Show detailed error
        echo "Error details:"
        python3 -c "import yaml; yaml.safe_load(open('$file'))" 2>&1 | head -5
        echo ""
    fi
}

# Find and validate all workflow files
for workflow_file in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
    if [ -f "$workflow_file" ]; then
        validate_workflow "$workflow_file"
    fi
done

echo ""
echo "📊 Validation Summary:"
echo "  ✅ Valid workflows: $VALID_COUNT"
echo "  ❌ Invalid workflows: $INVALID_COUNT"

if [ $INVALID_COUNT -eq 0 ]; then
    echo "🎉 All workflows are valid!"
    exit 0
else
    echo "⚠️  Some workflows have validation errors."
    exit 1
fi