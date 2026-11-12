# Fixli - Blue Collar Worker Platform

Fixli is an advanced platform (built as a Turborepo Monorepo) designed to bridge the gap between skilled blue-collar workers (plumbers, electricians, carpenters, etc.) and customers in need of their services. The platform integrates AI-driven matching, real-time geolocation tracking, robust verification systems, and emergency response features.

## Features

-   **Dual User Roles:** Separate, feature-rich interfaces for Customers and Workers.
-   **AI Service Analysis:** Customers describe their needs in natural language, and the Gemini API analyzes the request to categorize it, determine urgency, and find matching professionals.
-   **Live GPS Tracking:** Customers can track workers in real-time as they approach the job site.
-   **Worker Portfolio & Verification:** Visual gallery for workers to show past work and UI for document verification.
-   **Worker Dashboard:** A comprehensive dashboard for workers to manage job requests, view earnings, and update their profile.
-   **Real-time Chat:** Integrated WebSocket chat functionality for seamless communication.
-   **Multi-language Support:** The application supports English, Arabic, and Urdu.

## Technology Stack

-   **Monorepo:** Turborepo
-   **Mobile App:** React Native, Expo, Redux Toolkit, React Navigation
-   **Backend API:** NestJS, TypeScript, WebSocket (Socket.io)
-   **Database:** PostgreSQL (via Prisma ORM)
-   **Testing:** Jest, @testing-library/react-native (API line coverage 44.7% as of 2026-11-13; target ≥70%, see docs/27)
-   **AI Integration:** Google Gemini API

## Prerequisites

-   **Node.js:** (v18 or newer)
-   **pnpm:** (Package manager for Turborepo)
-   **Docker:** (To run the PostgreSQL database locally)
-   **Expo CLI:** (For mobile development)

## Getting Started

Follow these steps to get the application running on your local machine.

### 1. Database Setup

The backend requires a PostgreSQL database. A `docker-compose.yml` is provided.

```bash
# 1. Start the database
docker-compose up -d postgres

# 2. Push the Prisma schema
pnpm --filter api db:push
```

### 2. Environment Variables

Create `.env` files in both the `apps/api` and `apps/mobile` directories based on `.env.example` templates if they exist, or set the necessary keys (like `GEMINI_API_KEY` for the backend).

### 3. Running the Application

This is a Turborepo. You can start all applications simultaneously from the root directory.

```bash
# 1. Install dependencies
pnpm install

# 2. Start the development servers (API and Mobile)
pnpm run dev
```

### 4. Running Tests

Extensive test suites have been written to guarantee stability.

```bash
# Run backend tests with coverage
pnpm --filter api test:cov

# Run mobile tests
pnpm --filter mobile test
```
