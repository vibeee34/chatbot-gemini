import os
import uuid
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
from PyPDF2 import PdfReader
from langchain.schema import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import PGVector
from sentence_transformers import SentenceTransformer
import psycopg2
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GEMINI_API_KEY:
    logger.error("Missing GOOGLE_API_KEY.")
genai.configure(api_key=GEMINI_API_KEY)

CONNECTION_STRING = os.getenv("DATABASE_URL")
ACTIVE_COLLECTION = None

class LocalEmbeddingsAdapter:
    def __init__(self):
        self.model = SentenceTransformer("all-MiniLM-L6-v2")
    def embed_documents(self, texts):
        return self.model.encode(texts).tolist()
    def embed_query(self, text):
        return self.model.encode([text])[0].tolist()

try:
    GLOBAL_EMBEDDINGS_ADAPTER = LocalEmbeddingsAdapter()
    logger.info("SentenceTransformer model loaded globally.")
except Exception as e:
    logger.error(f"Failed to load SentenceTransformer model: {e}")
    GLOBAL_EMBEDDINGS_ADAPTER = None

def init_vector_store(embedding_function, collection_name):
    if not embedding_function:
        raise ValueError("Embedding function is not initialized.")
    return PGVector(
        connection_string=CONNECTION_STRING,
        embedding_function=embedding_function,
        collection_name=collection_name,
    )

@app.route("/upload-document", methods=["POST"])
def upload_document():
    global ACTIVE_COLLECTION
    try:
        if not GLOBAL_EMBEDDINGS_ADAPTER:
            return jsonify({"error": "Embeddings model failed to load on startup."}), 500

        file = request.files.get("file")
        if not file:
            return jsonify({"error": "No file uploaded"}), 400

        filename = file.filename
        pdf_reader = PdfReader(file)
        raw_text = ""
        for page in pdf_reader.pages:
            txt = page.extract_text()
            if txt:
                raw_text += txt + "\n"

        if not raw_text.strip():
            return jsonify({"error": "PDF contains no extractable text"}), 400

        splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        chunks = splitter.split_text(raw_text)
        docs = [Document(page_content=chunk) for chunk in chunks]

        collection_name = f"documents_{uuid.uuid4().hex}"

        if ACTIVE_COLLECTION:
            try:
                conn = psycopg2.connect(CONNECTION_STRING)
                cur = conn.cursor()
                cur.execute(f'DROP TABLE IF EXISTS "{ACTIVE_COLLECTION}" CASCADE;')
                conn.commit()
                cur.close()
                conn.close()
                logger.info(f"Deleted previous collection: {ACTIVE_COLLECTION}")
            except Exception as e:
                logger.warning(f"Failed to delete previous collection {ACTIVE_COLLECTION}: {e}")

        store = init_vector_store(GLOBAL_EMBEDDINGS_ADAPTER, collection_name)
        store.add_documents(docs)
        ACTIVE_COLLECTION = collection_name
        return jsonify({"message": f"Stored file '{filename}'."}), 200
    except Exception as e:
        logger.exception(f"Upload error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/query-rag", methods=["POST"])
def ask_question():
    try:
        if not ACTIVE_COLLECTION:
            return jsonify({"error": "No document uploaded yet"}), 400

        if not GLOBAL_EMBEDDINGS_ADAPTER:
            return jsonify({"error": "Embeddings model failed to load"}), 500

        data = request.get_json() or {}
        query = data.get("query", "")
        if not query:
            return jsonify({"error": "Please send a query."}), 400

        store = init_vector_store(GLOBAL_EMBEDDINGS_ADAPTER, ACTIVE_COLLECTION)
        retriever = store.as_retriever(search_kwargs={"k": 5})
        docs = retriever.get_relevant_documents(query)

        if not docs:
            return jsonify({"answer": "No relevant content found in the uploaded document."}), 200

        context = "\n---\n".join(doc.page_content for doc in docs)

        model_name = "gemini-2.5-flash"
        model = genai.GenerativeModel(model_name)

        prompt = (
            "You are an intelligent assistant. Use ONLY the provided context to answer the user's question. "
            "If the answer is not contained within the context, state that you cannot find the answer in the document."
            f"\n\nContext:\n{context}\n\nUser question: {query}"
        )
        
        response = model.generate_content(prompt, generation_config={"temperature": 0.1})
        answer = getattr(response, "text", str(response))
        return jsonify({"answer": answer}), 200
    except Exception as e:
        logger.exception("Error fetching answer from Gemini API.")
        return jsonify({"error": "Error fetching answer from Gemini API."}), 500

if __name__ == "__main__":
    logger.info("Server starting …")
    app.run(debug=True, port=5001)
