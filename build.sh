#!/bin/sh

# Define the source and destination directories
SRC_DIR=$(dirname "$0")
DEST_DIR="$SRC_DIR/build"

# Create the destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Copy the package.json file
cp "$SRC_DIR/package.json" "$DEST_DIR/package.json"

# Copy the readme.md file
cp "$SRC_DIR/readme.md" "$DEST_DIR/readme.md"

# Print the completion message
echo "Build completed."

# Print the completion message
echo "Now publishing on npm registry."
npm run build
cd build
npm publish
#
## Print the completion message
#echo "Completed."