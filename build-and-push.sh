#!/bin/bash
# Build and push multi-platform Docker images to Docker Hub
# This script builds for both AMD64 (Intel/AMD) and ARM64 (Apple Silicon)

set -e  # Exit on error

# Parse arguments
VERSION=${1:-$(cat VERSION 2>/dev/null || echo "latest")}
PUSH_FLAG=${2:-"--push"}

# If second argument is --no-push, don't push
if [ "$2" = "--no-push" ]; then
    PUSH_FLAG=""
    echo "⚠️  Build-only mode (will not push to Docker Hub)"
fi

# Get git commit SHA for additional tagging
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "🔨 Building multi-platform Docker images..."
echo "   Version: $VERSION"
echo "   Git SHA: $GIT_SHA"
echo ""

# Ensure buildx is set up
docker buildx create --use --name multiplatform-builder 2>/dev/null || docker buildx use multiplatform-builder

# Determine platforms
# Default to AMD64 for development speed, ARM64 added for stable tags
if [[ "$VERSION" == *"-patch."* ]] || [ "$2" = "--no-push" ]; then
    DEFAULT_PLATFORMS="linux/amd64"
    echo "⚡ Fast Build Mode: Building for $DEFAULT_PLATFORMS only"
else
    DEFAULT_PLATFORMS="linux/amd64,linux/arm64"
    echo "🌍 Release Build Mode: Building for $DEFAULT_PLATFORMS"
fi

PLATFORM_FLAG=${PLATFORMS:-$DEFAULT_PLATFORMS}
BUILD_ARGS="--platform $PLATFORM_FLAG"

if [ -n "$PUSH_FLAG" ]; then
    BUILD_ARGS="$BUILD_ARGS --push"
else
    BUILD_ARGS="$BUILD_ARGS --load"
fi

echo "📦 Building Web UI..."
docker buildx build $BUILD_ARGS \
  -t jsuzanne/sdwan-web-ui:latest \
  -t jsuzanne/sdwan-web-ui:$VERSION \
  -t jsuzanne/sdwan-web-ui:git-$GIT_SHA \
  --label "org.opencontainers.image.version=$VERSION" \
  --label "org.opencontainers.image.revision=$GIT_SHA" \
  -f web-dashboard/Dockerfile \
  .

echo ""
echo "📦 Building Traffic Generator..."
docker buildx build $BUILD_ARGS \
  -t jsuzanne/sdwan-traffic-gen:latest \
  -t jsuzanne/sdwan-traffic-gen:$VERSION \
  -t jsuzanne/sdwan-traffic-gen:git-$GIT_SHA \
  --label "org.opencontainers.image.version=$VERSION" \
  --label "org.opencontainers.image.revision=$GIT_SHA" \
  -f Dockerfile.traffic-gen \
  .

echo ""
if [ -n "$PUSH_FLAG" ]; then
    echo "✅ Done! Images pushed to Docker Hub:"
    echo "   - jsuzanne/sdwan-web-ui:latest"
    echo "   - jsuzanne/sdwan-web-ui:$VERSION"
    echo "   - jsuzanne/sdwan-web-ui:git-$GIT_SHA"
    echo "   - jsuzanne/sdwan-traffic-gen:latest"
    echo "   - jsuzanne/sdwan-traffic-gen:$VERSION"
    echo "   - jsuzanne/sdwan-traffic-gen:git-$GIT_SHA"
    echo ""
    echo "📥 On your deployment servers, run:"
    echo "   docker-compose pull"
    echo "   docker-compose up -d"
else
    echo "✅ Done! Images built locally (not pushed)"
    echo "   To push to Docker Hub, run:"
    echo "   ./build-and-push.sh $VERSION"
fi
echo ""
