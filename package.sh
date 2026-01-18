# Packages the current code version into a zip archive, for uploading to Mozilla.
VERSION=`jq -r '.version' manifest.json` || { echo "Error: Failed to extract version from manifest.json"; exit 1; }
mkdir -p ./release

# Generate excluded files list from .gitignore.
# This code block works, but zip -x flag is broken on mac :(
# Leaving it here for later. For now, releases are just annoying. 
# printf "%s" "\"./.git/*\" -x \"./.gitignore\"" > exclusions.txt
# cat .gitignore | while read -r line; do
#     printf "%s" " -x \"./$line\"" >> exclusions.txt 
# done

# zip -r release/$VERSION.zip ./ -x `cat exclusions.txt`
# rm exclusions.txt

git archive --format=zip -o release/resume_$VERSION.zip HEAD

# For now, just go manually fix the archive. Boo. Apple is annoying. Now I am using a mac just for one program. That's no good.
