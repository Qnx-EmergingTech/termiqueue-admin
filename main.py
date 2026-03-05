from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import firebase_admin
from firebase_admin import credentials, firestore

# Firebase Initialization
try:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Success: Connected to Firebase!")
except Exception as e:
    print(f"Error: Could not find the key file. {e}")

app = FastAPI()

# --- ADD THIS CORS SECTION ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Allows your Vite frontend
    allow_credentials=True,
    allow_methods=["*"],  # Allows GET, POST, etc.
    allow_headers=["*"],  # Allows all headers
)
# ------------------------------

@app.get("/")
def home():
    return {"message": "Your API is officially talking to Firebase and bypassing CORS!"}

# Example route to test the "profiles" error from your screenshot
@app.get("/profiles/")
def get_profiles():
    return {"status": "success", "data": []}