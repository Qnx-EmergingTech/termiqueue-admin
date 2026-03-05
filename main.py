from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import firebase_admin
from firebase_admin import credentials, firestore

# Firebase Initialization
try:
    # This connects the Python code to your Firebase using your key file
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Success: Connected to Firebase!")
except Exception as e:
    print(f"Error: Could not find the key file. {e}")

app = FastAPI()

# --- UPDATED: ALLOW FRONTEND ORIGIN ---
# This block fixes the "blocked by CORS policy" error
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Trust your Vite frontend
    allow_credentials=True,
    allow_methods=["*"],  # Allows all HTTP methods (GET, POST, etc.)
    allow_headers=["*"],  # Allows all headers
)
# ---------------------------------------

@app.get("/")
def home():
    return {"message": "Your API is officially talking to Firebase and bypassing CORS!"}

# Example route to verify the "profiles" connection
@app.get("/profiles/")
def get_profiles():
    return {"status": "success", "data": []}