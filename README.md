# Qesem — AI Study Assistant

[![Tech Stack](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)]() [![Tech Stack](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)]() [![Tech Stack](https://img.shields.io/badge/Vite-7-646cff?logo=vite&logoColor=white)]() [![Tech Stack](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)]() [![Tech Stack](https://img.shields.io/badge/MongoDB-Atlas-47a248?logo=mongodb&logoColor=white)]() [![AI](https://img.shields.io/badge/LangChain-%20LangGraph-1f6feb)]() [![SSE](https://img.shields.io/badge/Realtime-SSE-green)]() [![License](https://img.shields.io/badge/License-MIT-blue)]() [![Build](https://img.shields.io/badge/Build-NPM_Scripts-lightgrey)]()

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Running the Apps](#running-the-apps)
- [API Endpoints](#api-endpoints)
- [Usage Examples](#usage-examples)
- [Folder Structure](#folder-structure)
- [Contribution](#contribution)
- [License](#license)

## Overview

Qesem is an AI-powered study assistant. Students can upload PDFs or text notes, chat with an agentic assistant, generate quizzes automatically, and receive graded results. Responses stream in real time via Server-Sent Events (SSE), and answers are grounded with Retrieval-Augmented Generation (RAG) over your uploaded materials.

## Features

- **RAG over uploads**: Chunking and vector embeddings (Voyage AI) stored in MongoDB for grounded responses.
- **Agentic flows**: LangChain + LangGraph for quiz generation, grading, and contextual reasoning.
- **Realtime SSE**: Streaming assistant responses for smooth UX.
- **Quiz automation**: Auto-generate quizzes and grade user-submitted answers.
- **File uploads**: PDF/TXT ingestion with size limits and MIME validation.
- **Session history**: Persisted conversations with resume capability.
- **Configurable LLMs**: Gemini model selection via env; Voyage embed model override.
- **Dark UI**: React + Vite + Tailwind CSS 4 with responsive layout.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS 4, Zustand.
- **Backend**: Node.js, Express 5, TypeScript, MongoDB (Mongoose), SSE.
- **AI/ML**: LangChain, LangGraph, Gemini (Google Generative Language API), Voyage embeddings.
- **Build/Tooling**: Vite, ESLint, ts-node, TypeScript.

## Architecture

- **client/**: Vite React SPA; chat UI, quiz UI, SSE client, upload trigger.
- **server/**: Express API; routes for chat, quiz, upload, sessions, SSE; LLM + embedding services; MongoDB persistence.

## Getting Started

### Prerequisites

- Node.js 18+ (recommended)
- npm 9+
- MongoDB Atlas or local MongoDB
- API keys: Google Generative Language (Gemini) and Voyage AI

### Clone & Install

```bash
git clone https://github.com/CSEC-ASTU/Qesem.git
cd Qesem
npm install --prefix server
npm install --prefix client
```
