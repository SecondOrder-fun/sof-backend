#!/bin/bash

# Granular Access Control Migration Script
# Runs the 006_granular_access.sql migration

set -e

echo "🔐 SecondOrder.fun - Granular Access Control Migration"
echo "======================================================"
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL environment variable is not set"
    echo "Please set DATABASE_URL in your .env file or export it"
    exit 1
fi

# Load .env if it exists
if [ -f .env ]; then
    echo "📄 Loading environment from .env file..."
    export $(cat .env | grep -v '^#' | xargs)
fi

echo "📊 Database: ${DATABASE_URL%%\?*}"
echo ""

# Confirm before running
read -p "⚠️  This will modify your database. Continue? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Migration cancelled"
    exit 1
fi

echo ""
echo "🚀 Running migration..."
echo ""

# Run the migration
psql "$DATABASE_URL" -f migrations/006_granular_access.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration completed successfully!"
    echo ""
    echo "📋 Next steps:"
    echo "  1. Restart your backend server to load new routes"
    echo "  2. Access the admin panel to configure route access"
    echo "  3. Create access groups as needed"
    echo "  4. Assign users to groups"
    echo ""
else
    echo ""
    echo "❌ Migration failed!"
    echo "Please check the error messages above"
    exit 1
fi
