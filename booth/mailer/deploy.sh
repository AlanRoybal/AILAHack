#!/usr/bin/env bash
# Deploys the Gmail send Lambda (AWS CLI v2). Needs AWS creds, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, SEND_TOKEN, ALLOWED_TO.
set -euo pipefail
cd "$(dirname "$0")"
FN=booth-brief-mailer ROLE=booth-brief-mailer-role
if ! ROLE_ARN=$(aws iam get-role --role-name $ROLE --query Role.Arn --output text 2>/dev/null); then
  ROLE_ARN=$(aws iam create-role --role-name $ROLE --query Role.Arn --output text --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}')
  aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  sleep 10
fi
rm -f fn.zip && zip -q fn.zip index.mjs
ENVJSON=$(python3 -c 'import json,os;print(json.dumps({"Variables":{"CLIENT_ID":os.environ["GMAIL_CLIENT_ID"],"CLIENT_SECRET":os.environ["GMAIL_CLIENT_SECRET"],"REFRESH_TOKEN":os.environ["GMAIL_REFRESH_TOKEN"],"SEND_TOKEN":os.environ["SEND_TOKEN"],"ALLOWED_TO":os.environ.get("ALLOWED_TO","")}}))')
if aws lambda get-function --function-name $FN >/dev/null 2>&1; then
  aws lambda update-function-code --function-name $FN --zip-file fileb://fn.zip >/dev/null
  aws lambda wait function-updated --function-name $FN
  aws lambda update-function-configuration --function-name $FN --environment "$ENVJSON" >/dev/null
else
  aws lambda create-function --function-name $FN --runtime nodejs22.x --handler index.handler --role "$ROLE_ARN" \
    --timeout 20 --zip-file fileb://fn.zip --environment "$ENVJSON" >/dev/null
  aws lambda wait function-active --function-name $FN
  aws lambda create-function-url-config --function-name $FN --auth-type NONE >/dev/null
  aws lambda add-permission --function-name $FN --statement-id public-url --action lambda:InvokeFunctionUrl \
    --principal '*' --function-url-auth-type NONE >/dev/null
  aws lambda add-permission --function-name $FN --statement-id public-invoke --action lambda:InvokeFunction \
    --principal '*' --invoked-via-function-url >/dev/null
fi
rm -f fn.zip
aws lambda get-function-url-config --function-name $FN --query FunctionUrl --output text
