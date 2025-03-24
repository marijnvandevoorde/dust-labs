# Guru to Dust Data Sync

This script is a Node.js application designed to sync Guru cards into Dust datasources. It fetches all cards from your Guru knowledge base and uploads them to a specified Dust datasource while maintaining their structure and content.

## Usage example

Example of a Guru card added to the Dust datasource:

```
Card ID: 6a7b8c9d-1234-5678-90ab-cdef12345678

Title: Setting Up Two-Factor Authentication
Owner: jane.smith@company.com
First Name: Jane
Last Name: Smith
Verifier: john.doe@company.com
Collection: Security Guidelines
Boards: 
  - Security Best Practices
  - Employee Onboarding
Verification Date: 2024-03-18T15:30:00.000Z
Verification State: verified
Verification Interval: 90
Link: https://app.getguru.com/card/6a7b8c9d-1234-5678-90ab-cdef12345678

Content:
# Setting Up Two-Factor Authentication

Two-factor authentication (2FA) adds an extra layer of security to your account. 
Follow these steps to enable 2FA:

1. Log into your account settings
2. Navigate to Security > Two-Factor Authentication
3. Choose your preferred 2FA method:
   - Authenticator app (recommended)
   - SMS verification
   - Security key
4. Follow the setup wizard to complete configuration

Remember to save your backup codes in a secure location.
```

## Features

- Bulk synchronization of all Guru cards
- Preserves card metadata including:
  - Card ID and title
  - Collection and board information
  - Owner and verifier details
  - Verification status
  - Last modified and verification dates
  - Tags and categories
- Rate limiting for both Guru and Dust APIs
- Concurrent processing with configurable limits
- Detailed logging and error handling

## Prerequisites

- Node.js (version 14 or higher)
- npm (Node Package Manager)
- Guru account with API access
- Dust account with API access

## Installation

1. Clone the repository:
   ```bash
   git clone git@github.com:dust-tt/dust-labs.git
   cd dust-labs
   cd guru
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file.

### Environment Variables Explained

#### Guru Credentials
- `GURU_API_TOKEN`: Your Guru API token
  - Found in Guru under Settings > API & Integrations
  - Format: Starts with 'gku_'
  - Required for authenticating with the Guru API

- `GURU_EMAIL`: Your Guru account email
  - Must match the email associated with the API token
  - Used for API authentication

#### Dust Credentials
- `DUST_API_KEY`: Your Dust API key
  - Found in your Dust account settings
  - Format: Starts with 'sk-'
  - Required for authenticating with the Dust API

- `DUST_WORKSPACE_ID`: Your Dust workspace identifier
  - Found in your Dust workspace URL or settings
  - Format: ws-xxxxxxxxx
  - Identifies which workspace to sync data to

- `DUST_DATASOURCE_ID`: Your Dust datasource identifier
  - Format: ds-xxxxxxxxx
  - Specifies which datasource will store the Guru cards

#### Rate Limiting Configuration
- `DUST_RATE_LIMIT`: Maximum requests per minute to Dust API
  - Adjust based on your Dust API tier
  - Prevents API rate limit errors

- `GURU_MAX_CONCURRENT`: Maximum concurrent card processing operations
  - Adjust based on your system resources
  - Controls parallel processing of Guru cards

## Usage

To run the script:

```bash
npm run sync
```

The script will:
1. Validate environment variables
2. Connect to Guru and fetch all cards
3. Process each card concurrently (respecting rate limits)
4. Upload formatted data to your Dust datasource

## How It Works

1. The script authenticates with Guru using the provided email and API token
2. It retrieves all cards from your Guru knowledge base
3. Each card is processed and formatted into a hierarchical structure:
   - Metadata section containing card properties
   - Content section with the actual card content
4. The formatted data is uploaded to Dust using unique document IDs
5. Rate limiting is applied to respect both Guru and Dust API constraints

## Rate Limiting

The script implements rate limiting using Bottleneck:
- Concurrent operations: Controlled by `GURU_MAX_CONCURRENT`
- Dust API rate limit: Controlled by `DUST_RATE_LIMIT`
- Automatic queue management and retry logic

## Error Handling

The script includes comprehensive error handling:
- Validates required environment variables
- Handles API rate limits and retries
- Provides detailed error logging
- Continues processing on individual card failures

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the ISC License.
