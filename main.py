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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return {"message": "API is Active"}

# --- ADD THESE ROUTES TO FIX THE 404 ERRORS ---

@app.get("/profiles/me/trips/all")
def get_all_trips():
    return [] # Returns empty list instead of 404

@app.get("/buses/")
def get_buses():
    return [] # Returns empty list instead of 404

@app.get("/queue/")
def get_queue():
    return [] # Returns empty list instead of 404

@app.get("/profiles/")
def get_profiles():
    return [] # Returns empty list instead of 404