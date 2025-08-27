#!/bin/bash

# AWS MediaConvert Setup Script
# This script sets up all AWS infrastructure needed for MediaConvert video transcoding

set -e

echo "🎬 Setting up AWS MediaConvert infrastructure..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "📋 AWS Account ID: $ACCOUNT_ID"

# Get current region
REGION=$(aws configure get region)
if [ -z "$REGION" ]; then
    REGION="us-east-1"
    echo "⚠️  No default region set, using us-east-1"
else
    echo "📍 Using region: $REGION"
fi

# Generate unique bucket names
PROJECT_NAME="trypostify"
INPUT_BUCKET="${PROJECT_NAME}-mediaconvert-input-${ACCOUNT_ID}"
OUTPUT_BUCKET="${PROJECT_NAME}-mediaconvert-output-${ACCOUNT_ID}"

echo "🪣 Creating S3 buckets..."

# Create input bucket
if aws s3 mb s3://$INPUT_BUCKET --region $REGION 2>/dev/null; then
    echo -e "${GREEN}✅ Created input bucket: $INPUT_BUCKET${NC}"
else
    echo -e "${YELLOW}⚠️  Input bucket already exists or creation failed: $INPUT_BUCKET${NC}"
fi

# Create output bucket
if aws s3 mb s3://$OUTPUT_BUCKET --region $REGION 2>/dev/null; then
    echo -e "${GREEN}✅ Created output bucket: $OUTPUT_BUCKET${NC}"
else
    echo -e "${YELLOW}⚠️  Output bucket already exists or creation failed: $OUTPUT_BUCKET${NC}"
fi

echo "🔐 Setting up IAM role for MediaConvert..."

# Create trust policy for MediaConvert
cat > /tmp/mediaconvert-trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": "mediaconvert.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
EOF

# Create IAM role
ROLE_NAME="MediaConvertRole"
if aws iam create-role \
    --role-name $ROLE_NAME \
    --assume-role-policy-document file:///tmp/mediaconvert-trust-policy.json 2>/dev/null; then
    echo -e "${GREEN}✅ Created IAM role: $ROLE_NAME${NC}"
else
    echo -e "${YELLOW}⚠️  IAM role already exists: $ROLE_NAME${NC}"
fi

# Create custom policy for S3 access
cat > /tmp/mediaconvert-s3-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:GetObjectVersion"
            ],
            "Resource": [
                "arn:aws:s3:::$INPUT_BUCKET/*",
                "arn:aws:s3:::$OUTPUT_BUCKET/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::$INPUT_BUCKET",
                "arn:aws:s3:::$OUTPUT_BUCKET"
            ]
        }
    ]
}
EOF

# Create and attach custom policy
POLICY_NAME="MediaConvertS3Access"
POLICY_ARN="arn:aws:iam::$ACCOUNT_ID:policy/$POLICY_NAME"

if aws iam create-policy \
    --policy-name $POLICY_NAME \
    --policy-document file:///tmp/mediaconvert-s3-policy.json 2>/dev/null; then
    echo -e "${GREEN}✅ Created IAM policy: $POLICY_NAME${NC}"
else
    echo -e "${YELLOW}⚠️  IAM policy already exists: $POLICY_NAME${NC}"
fi

# Attach policy to role
if aws iam attach-role-policy \
    --role-name $ROLE_NAME \
    --policy-arn $POLICY_ARN; then
    echo -e "${GREEN}✅ Attached policy to role${NC}"
fi

# Wait for IAM consistency
echo "⏳ Waiting for IAM role to propagate..."
sleep 10

echo "🔍 Getting MediaConvert endpoint..."

# Get MediaConvert endpoint
MEDIACONVERT_ENDPOINT=$(aws mediaconvert describe-endpoints --region $REGION --query 'Endpoints[0].Url' --output text)
echo -e "${GREEN}✅ MediaConvert endpoint: $MEDIACONVERT_ENDPOINT${NC}"

# Create job template for Twitter-compatible videos
echo "📄 Creating MediaConvert job template..."

cat > /tmp/twitter-video-template.json << EOF
{
  "Name": "TwitterVideoTemplate",
  "Description": "Template for converting videos to Twitter-compatible format",
  "Category": "Social Media",
  "Settings": {
    "OutputGroups": [
      {
        "Name": "Twitter Compatible Output",
        "OutputGroupSettings": {
          "Type": "FILE_GROUP_SETTINGS",
          "FileGroupSettings": {
            "Destination": "s3://$OUTPUT_BUCKET/"
          }
        },
        "Outputs": [
          {
            "NameModifier": "_twitter",
            "VideoDescription": {
              "Width": 1280,
              "Height": 720,
              "CodecSettings": {
                "Codec": "H_264",
                "H264Settings": {
                  "MaxBitrate": 25000000,
                  "RateControlMode": "QVBR",
                  "QvbrSettings": {
                    "QvbrQualityLevel": 8
                  },
                  "SceneChangeDetect": "TRANSITION_DETECTION",
                  "FramerateControl": "SPECIFIED",
                  "FramerateNumerator": 30,
                  "FramerateDenominator": 1
                }
              }
            },
            "AudioDescriptions": [
              {
                "AudioTypeControl": "FOLLOW_INPUT",
                "CodecSettings": {
                  "Codec": "AAC",
                  "AacSettings": {
                    "Bitrate": 96000,
                    "CodingMode": "CODING_MODE_2_0",
                    "SampleRate": 48000
                  }
                }
              }
            ],
            "ContainerSettings": {
              "Container": "MP4",
              "Mp4Settings": {
                "CslgAtom": "INCLUDE",
                "FreeSpaceBox": "EXCLUDE",
                "MoovPlacement": "PROGRESSIVE_DOWNLOAD"
              }
            }
          }
        ]
      }
    ],
    "AdAvailOffset": 0,
    "Inputs": [
      {
        "AudioSelectors": {
          "Audio Selector 1": {
            "Offset": 0,
            "DefaultSelection": "DEFAULT",
            "ProgramSelection": 1
          }
        },
        "VideoSelector": {
          "ColorSpace": "FOLLOW"
        },
        "FilterEnable": "AUTO",
        "PsiControl": "USE_PSI",
        "FilterStrength": 0,
        "DeblockFilter": "DISABLED",
        "DenoiseFilter": "DISABLED",
        "TimecodeSource": "EMBEDDED",
        "FileInput": "s3://$INPUT_BUCKET/placeholder.mp4"
      }
    ]
  }
}
EOF

# Create the job template
if aws mediaconvert create-job-template \
    --endpoint-url $MEDIACONVERT_ENDPOINT \
    --region $REGION \
    --cli-input-json file:///tmp/twitter-video-template.json 2>/dev/null; then
    echo -e "${GREEN}✅ Created job template: TwitterVideoTemplate${NC}"
else
    echo -e "${YELLOW}⚠️  Job template may already exist${NC}"
fi

# Clean up temp files
rm -f /tmp/mediaconvert-trust-policy.json
rm -f /tmp/mediaconvert-s3-policy.json
rm -f /tmp/twitter-video-template.json

# Generate environment variables
ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"

echo ""
echo -e "${GREEN}🎉 MediaConvert setup complete!${NC}"
echo ""
echo "📝 Add these environment variables to your .env.local file:"
echo "----------------------------------------"
echo "MEDIACONVERT_ENDPOINT=$MEDIACONVERT_ENDPOINT"
echo "MEDIACONVERT_ROLE_ARN=$ROLE_ARN"
echo "MEDIACONVERT_INPUT_BUCKET=$INPUT_BUCKET"
echo "MEDIACONVERT_OUTPUT_BUCKET=$OUTPUT_BUCKET"
echo "----------------------------------------"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Add the environment variables above to your .env.local file"
echo "2. Run the MediaConvert client implementation"
echo "3. Test with a sample video"
echo ""
echo -e "${GREEN}Total setup time: ~2 minutes${NC}"
