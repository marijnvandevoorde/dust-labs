import axios from "axios";
import * as dotenv from "dotenv";
import Bottleneck from "bottleneck";
import { Guru, GuruCard } from "./guru";

dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
    'GURU_API_TOKEN',
    'GURU_EMAIL',
    'DUST_API_KEY',
    'DUST_WORKSPACE_ID',
    'DUST_DATASOURCE_ID',
    'DUST_RATE_LIMIT',
    'GURU_MAX_CONCURRENT'
  ];
  
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  throw new Error(
    `Please provide values for the following environment variables: ${missingEnvVars.join(', ')}`
  );
}

const DUST_API_KEY = process.env.DUST_API_KEY;
const DUST_WORKSPACE_ID = process.env.DUST_WORKSPACE_ID;
const DUST_DATASOURCE_ID = process.env.DUST_DATASOURCE_ID;

// Rate limiting configuration
const DUST_RATE_LIMIT = parseInt(process.env.DUST_RATE_LIMIT as string);
const GURU_MAX_CONCURRENT = parseInt(process.env.GURU_MAX_CONCURRENT as string);

// Guru credentials from environment
const GURU_EMAIL = process.env.GURU_EMAIL as string;
const GURU_API_TOKEN = process.env.GURU_API_TOKEN as string;

// Initialize Dust API client
const dustApi = axios.create({
  baseURL: "https://dust.tt/api/v1",
  headers: {
    Authorization: `Bearer ${DUST_API_KEY}`,
    "Content-Type": "application/json",
  },
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
});

async function uploadCardsToDust() {
  const guru = new Guru({
    email: GURU_EMAIL,
    token: GURU_API_TOKEN
  });
  const cards = await guru.getAllCards();
  
  console.log(`Processing ${cards.length} cards...`);
  
  // Use Bottleneck for rate limiting as in the original script
  const limiter = new Bottleneck({
    maxConcurrent: GURU_MAX_CONCURRENT,
    minTime: 60 * 1000 / DUST_RATE_LIMIT,
  });
  
  const tasks = cards.map((card: GuruCard) => {
    return limiter.schedule(() => formatAndUploadCardToDust(card));
  });
  
  await Promise.all(tasks);
  console.log("All cards processed successfully.");
}

async function formatAndUploadCardToDust(card: GuruCard) {
  
  try {
    // Create a section structure for Dust
    const metadataSections = Object.keys(card).map(key => ({
      prefix: key,
      content: JSON.stringify(card[key]),
      sections: []
    }));
    const section = {
      prefix: card.id,
      content: card.content,
      sections: metadataSections
    };
    
    // Upload to Dust
    const documentId = `guru-card-${card.id}`;
    await dustApi.post(
      `/w/${DUST_WORKSPACE_ID}/data_sources/${DUST_DATASOURCE_ID}/documents/${documentId}`,
      {
        section: section,
        title: card.title,
      }
    );
    
    console.log(`Uploaded card "${card.title}" to Dust`);
  } catch (error) {
    console.error(`Error uploading card "${card.title}" to Dust:`, error);
    throw error;
  }
}

async function main() {
  try{    
    await uploadCardsToDust();
    
  } catch (error) {
    console.error("An error occurred:", error);
    process.exit(1);
  }
}

main();