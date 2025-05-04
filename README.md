# Route Planning Application

A Flask-based web application that allows users to:
- Search for addresses and find routes between them
- Display points of interest (restaurants, parks) along the route
- Adjust routes to include selected points of interest

## Features

- Address geocoding
- Route planning between two addresses
- Points of interest discovery
- Route adjustment based on selected POIs
- Interactive map display

## Requirements

- Python 3.7+
- Flask
- Mapbox account (for maps and routing)

## Setup

1. Clone the repository:
```
git clone https://github.com/yourusername/route_app.git
cd route_app
```

2. Create a virtual environment and activate it:
```
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```
pip install -r requirements.txt
```

4. Create a `.env` file from the example:
```
cp .env.example .env
```

5. Edit the `.env` file to add your own Mapbox token and a secure secret key:
```
SECRET_KEY=your-secure-random-key
MAPBOX_TOKEN=your-mapbox-token
```

You can get a Mapbox token by signing up at https://account.mapbox.com/auth/signup/

## Running the Application

Start the Flask development server:

```
python app.py
```

Open your browser and navigate to `http://127.0.0.1:5000`

## Usage

1. Enter a start address and end address in the form
2. Click "Find Route" to display a route between the addresses
3. Select a point of interest type (restaurants or parks)
4. Click "Show Points of Interest" to display POIs near the route
5. Click on POIs to select them (either on the map or in the sidebar list)
6. Click "Adjust Route" to update the route to include selected POIs
7. Click "Reset Route" to return to the original route

## Implementation Notes

This is a demonstration app that uses mock data for points of interest and simplified routing. In a production environment, you would:

1. Implement a real routing API (like Mapbox Directions API)
2. Use a real POI API (like Google Places or Mapbox POI API)
3. Add proper error handling and input validation
4. Add user accounts and saved routes
5. Optimize for performance with larger datasets 