from flask import Flask, render_template, request, jsonify, send_from_directory, send_file
from dotenv import load_dotenv
import os
import requests
from geopy.geocoders import Nominatim
from openai import OpenAI
import pandas as pd

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'development-key')

# Initialize geocoder
geocoder = Nominatim(user_agent="route_app")

# API keys
MAPBOX_TOKEN = os.getenv('MAPBOX_TOKEN', '')
GOOGLE_MAPS_API_KEY = os.getenv('GOOGLE_MAPS_API_KEY', 'AIzaSyChefv1LfV5ug_IZO__nHlMAVBLr0M7q7E')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Check if OpenAI API key is available
if not OPENAI_API_KEY:
    print("WARNING: No OpenAI API key found in environment variables. Chat functionality will be limited.")

# Initialize OpenAI client only if API key is available
openai_client = None
if OPENAI_API_KEY:
    openai_client = OpenAI(api_key=OPENAI_API_KEY)

@app.route('/')
def index():
    return render_template('index.html', mapbox_token=MAPBOX_TOKEN)

@app.route('/chat', methods=['POST'])
def chat():
    """Handle chat messages using OpenAI API"""
    data = request.json
    messages = data.get('messages', [])
    
    if not messages:
        return jsonify({'success': False, 'error': 'No messages provided'})
    
    # Check if OpenAI client is initialized
    if not openai_client:
        return jsonify({
            'success': True,
            'message': "I'm sorry, but the chat service is currently unavailable due to missing API credentials. Please set up your OpenAI API key in the environment variables."
        })
    
    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.7,
            max_tokens=1000
        )
        
        return jsonify({
            'success': True,
            'message': response.choices[0].message.content
        })
    except Exception as e:
        error_message = str(e)
        
        # Check for quota exceeded error
        if "insufficient_quota" in error_message or "exceeded your current quota" in error_message:
            return jsonify({
                'success': True,
                'message': "I'm sorry, but the OpenAI API quota has been exceeded. Please update your API key or billing information. In the meantime, I can provide basic assistance with route planning and safety information based on available data."
            })
        # Handle rate limiting
        elif "rate limit" in error_message.lower() or "rate_limit" in error_message:
            return jsonify({
                'success': True,
                'message': "I'm processing too many requests right now. Please try again in a moment."
            })
        # General error
        else:
            return jsonify({
                'success': False, 
                'error': f"Error communicating with AI service: {error_message}"
            })

@app.route('/geocode', methods=['POST'])
def geocode_address():
    """Convert address to coordinates"""
    data = request.json
    address = data.get('address')
    
    try:
        location = geocoder.geocode(address)
        if location:
            return jsonify({
                'success': True,
                'lat': location.latitude,
                'lng': location.longitude,
                'address': location.address
            })
        else:
            return jsonify({'success': False, 'error': 'Address not found'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/route', methods=['POST'])
def get_route():
    data = request.json
    start_coords = data.get('start')
    end_coords = data.get('end')
    mode = data.get('mode', 'walking')
    waypoints = data.get('waypoints', [])
    alternatives = data.get('alternatives', False)
    use_mapbox = data.get('use_mapbox', True)  # Default to using Mapbox for better alternatives
    
    if not start_coords or not end_coords:
        return jsonify({"success": False, "error": "Missing coordinates"})
    
    try:
        # Always use diverse_routes function when alternatives are requested
        # This gives us the best real route options
        if alternatives:
            try:
                return get_diverse_routes(start_coords, end_coords, mode, waypoints)
            except Exception as e:
                print(f"Error generating diverse routes: {e}, falling back to standard routing")
        
        # Standard routing path - still using real routes
        # Try Mapbox Directions API first for better alternatives
        if use_mapbox and MAPBOX_TOKEN:
            try:
                return get_route_mapbox(start_coords, end_coords, mode, waypoints, alternatives)
            except Exception as e:
                print(f"Mapbox API error: {e}, falling back to OSRM")
                # Fall back to OSRM if Mapbox fails
                pass
        
        # OSRM fallback - still a real route
        return get_route_osrm(start_coords, end_coords, mode, waypoints, alternatives)
    except Exception as e:
        print(f"Error calculating route: {e}")
        return jsonify({"success": False, "error": str(e)})

def get_diverse_routes(start_coords, end_coords, mode, waypoints):
    """Get maximally diverse route options by combining results from multiple routing approaches"""
    all_routes = []
    route_sources = []
    
    # Try Mapbox (optimal route)
    if MAPBOX_TOKEN:
        try:
            mapbox_response = requests.get(
                f"https://api.mapbox.com/directions/v5/mapbox/walking/{start_coords[0]},{start_coords[1]};{end_coords[0]},{end_coords[1]}",
                params={
                    "access_token": MAPBOX_TOKEN,
                    "geometries": "geojson",
                    "alternatives": "true",
                    "overview": "full"
                }
            )
            
            if mapbox_response.status_code == 200:
                mapbox_data = mapbox_response.json()
                if mapbox_data.get('routes'):
                    for route in mapbox_data['routes']:
                        all_routes.append({
                            "path": route['geometry']['coordinates'],
                            "distance": route['distance'],
                            "duration": route['duration'],
                            "source": "mapbox"
                        })
                        route_sources.append("mapbox")
        except Exception as e:
            print(f"Mapbox routing error: {e}")
    
    # Try OSRM (fastest route)
    try:
        start_str = f"{start_coords[0]},{start_coords[1]}"
        end_str = f"{end_coords[0]},{end_coords[1]}"
        
        osrm_response = requests.get(
            f"https://router.project-osrm.org/route/v1/walking/{start_str};{end_str}",
            params={
                "overview": "full",
                "geometries": "geojson",
                "alternatives": "true"
            }
        )
        
        if osrm_response.status_code == 200:
            osrm_data = osrm_response.json()
            if osrm_data.get('routes'):
                walking_speed_m_per_s = 1.38  # 5 km/h
                
                for route in osrm_data['routes']:
                    path = route['geometry']['coordinates']
                    distance = route['distance']
                    duration = distance / walking_speed_m_per_s * 1.1
                    
                    all_routes.append({
                        "path": path,
                        "distance": distance,
                        "duration": duration,
                        "source": "osrm-fast"
                    })
                    route_sources.append("osrm-fast")
    except Exception as e:
        print(f"OSRM routing error: {e}")
    
    # Try OSRM with different parameters (scenic route)
    try:
        osrm_scenic_response = requests.get(
            f"https://router.project-osrm.org/route/v1/walking/{start_str};{end_str}",
            params={
                "overview": "full",
                "geometries": "geojson",
                "alternatives": "true",
                "approaches": "curb;curb",
                "walking_speed": "1.0"  # Slower walking speed for more scenic routes
            }
        )
        
        if osrm_scenic_response.status_code == 200:
            osrm_data = osrm_scenic_response.json()
            if osrm_data.get('routes'):
                walking_speed_m_per_s = 1.0  # Slower speed
                
                for route in osrm_data['routes']:
                    path = route['geometry']['coordinates']
                    distance = route['distance']
                    duration = distance / walking_speed_m_per_s * 1.1
                    
                    all_routes.append({
                        "path": path,
                        "distance": distance,
                        "duration": duration,
                        "source": "osrm-scenic"
                    })
                    route_sources.append("osrm-scenic")
    except Exception as e:
        print(f"OSRM scenic routing error: {e}")
    
    # If we have at least one route, return the results
    if all_routes:
        # Select the primary (fastest) route
        primary_route = all_routes[0]
        
        # Filter alternatives to ensure they're significantly different
        filtered_alternatives = []
        paths_to_compare = [primary_route["path"]]
        
        for i in range(1, len(all_routes)):
            alternative = all_routes[i]
            is_unique = True
            
            # Compare with all previously selected paths
            for existing_path in paths_to_compare:
                if not is_significantly_different(existing_path, alternative["path"]):
                    is_unique = False
                    break
            
            if is_unique:
                filtered_alternatives.append(alternative)
                paths_to_compare.append(alternative["path"])
                
                # Limit to max 3 alternatives for simplicity
                if len(filtered_alternatives) >= 3:
                    break
        
        return jsonify({
            "success": True,
            "path": primary_route["path"],
            "distance": primary_route["distance"],
            "duration": primary_route["duration"],
            "alternatives": filtered_alternatives,
            "source": primary_route["source"],
            "all_real": True
        })
    
    # If we couldn't get any routes, return an error instead of falling back to simulated routes
    return jsonify({"success": False, "error": "No routes found for this journey. Please try a different destination or starting point."})

def is_significantly_different(path1, path2):
    """Check if two paths are significantly different from each other"""
    # If path lengths are very different, they're different routes
    if abs(len(path1) - len(path2)) > min(len(path1), len(path2)) * 0.2:
        return True
    
    # Sample points along the routes and check for differences
    num_points = min(10, min(len(path1), len(path2)) // 2)
    if num_points < 3:
        return False
    
    different_points = 0
    for i in range(num_points):
        idx = int(i * (min(len(path1), len(path2)) - 1) / (num_points - 1))
        p1 = path1[idx]
        p2 = path2[idx]
        
        # Calculate distance between points
        dist = ((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2) ** 0.5
        
        # If points are more than 100m apart (roughly 0.001 degrees), they're different
        if dist > 0.001:
            different_points += 1
    
    # If more than 50% of sampled points are different, it's a different route
    return different_points > num_points * 0.5

def get_route_mapbox(start_coords, end_coords, mode, waypoints, alternatives):
    """Get route using Mapbox Directions API"""
    # Convert to Mapbox format (lon,lat)
    start_str = f"{start_coords[0]},{start_coords[1]}"
    end_str = f"{end_coords[0]},{end_coords[1]}"
    
    # Format waypoints for Mapbox
    waypoints_str = ""
    if waypoints and len(waypoints) > 0:
        waypoints_formatted = [f"{wp[0]},{wp[1]}" for wp in waypoints]
        waypoints_str = ";" + ";".join(waypoints_formatted)
    
    # Map mode to Mapbox profile
    profile = "walking"
    if mode == "cycling":
        profile = "cycling"
    elif mode == "driving":
        profile = "driving"
    
    # Build Mapbox Directions API URL
    mapbox_url = f"https://api.mapbox.com/directions/v5/mapbox/{profile}/{start_str}{waypoints_str};{end_str}"
    
    # Add query parameters
    params = {
        "access_token": MAPBOX_TOKEN,
        "geometries": "geojson",
        "steps": "false",
        "overview": "full",
    }
    
    if alternatives:
        params["alternatives"] = "true"
    
    # Make request to Mapbox
    response = requests.get(mapbox_url, params=params)
    
    if response.status_code != 200:
        raise Exception(f"Mapbox API error: {response.status_code}")
    
    route_data = response.json()
    
    # Check for valid routes
    if not route_data.get('routes') or len(route_data['routes']) == 0:
        raise Exception("No route found")
    
    # Extract primary route
    primary_route = route_data['routes'][0]
    
    # Extract coordinates
    path = primary_route['geometry']['coordinates']
    distance = primary_route['distance']  # in meters
    duration = primary_route['duration']  # in seconds
    
    # Extract alternative routes if available
    alternatives_data = []
    if alternatives and len(route_data['routes']) > 1:
        for alt_route in route_data['routes'][1:]:
            alt_path = alt_route['geometry']['coordinates']
            # Skip if route is too similar to primary route
            if len(alt_path) < 3:
                continue
                
            alternatives_data.append({
                "path": alt_path,
                "distance": alt_route['distance'],
                "duration": alt_route['duration']
            })
    
    return jsonify({
        "success": True,
        "path": path,
        "distance": distance,
        "duration": duration,
        "alternatives": alternatives_data,
        "source": "mapbox"
    })

def get_route_osrm(start_coords, end_coords, mode, waypoints, alternatives):
    """Get route using OSRM API (open-source fallback)"""
    # Convert coordinates to OSRM format (long,lat)
    start_str = f"{start_coords[0]},{start_coords[1]}"
    end_str = f"{end_coords[0]},{end_coords[1]}"
    
    # Format waypoints if any
    waypoints_str = ""
    if waypoints and len(waypoints) > 0:
        waypoints_formatted = [f"{wp[0]},{wp[1]}" for wp in waypoints]
        waypoints_str = ";" + ";".join(waypoints_formatted)
    
    # Call OSRM API
    # Using alternatives=3 to explicitly request up to 3 alternative routes
    osrm_url = f"https://router.project-osrm.org/route/v1/{mode}/{start_str}{waypoints_str};{end_str}?overview=full&geometries=geojson"
    
    # Add parameter to ensure route passes through all waypoints and request alternatives if needed
    params = []
    if waypoints and len(waypoints) > 0:
        params.append("continue_straight=true")
    
    if alternatives:
        # Request up to 5 alternatives for better coverage
        params.append("alternatives=5")
        # Add different weightings for more diverse routes
        params.append("approaches=curb;curb")
        # Increase alternative snapping threshold to get more varied routes
        params.append("snapping_radiuses=100;100")
        # Set different walking speeds to get different routes
        params.append("walking_speed=1.2;1.5;1.8")
    
    if params:
        osrm_url += "&" + "&".join(params)
    
    response = requests.get(osrm_url)
    route_data = response.json()
    
    # Check for valid route
    if route_data.get('code') != 'Ok' or not route_data.get('routes'):
        return jsonify({"success": False, "error": "No route found"})
    
    # Extract route geometry from the first route (primary)
    route = route_data['routes'][0]
    path = route['geometry']['coordinates']
    distance = route['distance']  # in meters
    
    # Recalculate duration based on realistic walking speed (5 km/h = 1.38 m/s)
    # This overrides the API's duration which can sometimes be unrealistic
    walking_speed_m_per_s = 1.38  # 5 km/h in meters per second
    duration = distance / walking_speed_m_per_s  # in seconds
    
    # Add extra time for elevation changes, intersections, etc. (about 10%)
    duration = duration * 1.1
    
    # Extract alternative routes if available
    alternatives_data = []
    if alternatives and len(route_data['routes']) > 1:
        for alt_route in route_data['routes'][1:]:
            alt_path = alt_route['geometry']['coordinates']
            alt_distance = alt_route['distance']
            alt_duration = alt_distance / walking_speed_m_per_s * 1.1
            
            alternatives_data.append({
                "path": alt_path,
                "distance": alt_distance,
                "duration": alt_duration
            })
    
    return jsonify({
        "success": True,
        "path": path,
        "distance": distance,
        "duration": duration,
        "alternatives": alternatives_data,
        "source": "osrm"
    })

@app.route('/points_of_interest', methods=['POST'])
def get_points_of_interest():
    """Get points of interest around a route using Google Places API"""
    data = request.json
    bounds = data.get('bounds')  # [[minLng, minLat], [maxLng, maxLat]]
    type_filter = data.get('type', 'restaurant')  # 'restaurant', 'park', etc.
    keyword = data.get('keyword', '')  # Optional search keyword
    
    if not bounds:
        return jsonify({'success': False, 'error': 'Bounds are required'})
    
    try:
        # Calculate center point from bounds
        center_lat = (bounds[0][1] + bounds[1][1]) / 2
        center_lng = (bounds[0][0] + bounds[1][0]) / 2
        
        # Convert bounds to radius (approximate)
        # Calculate distance from center to corner (in meters)
        lat_diff = abs(bounds[1][1] - bounds[0][1])
        lng_diff = abs(bounds[1][0] - bounds[0][0])
        radius = max(lat_diff, lng_diff) * 111000 / 2  # 111km per degree of latitude, divide by 2 for radius
        
        # Limit radius to 50km (Google Places API limit)
        radius = min(radius, 50000)
        
        # Map our type filter to Google Places type
        google_type = type_filter
        if type_filter == 'park':
            google_type = 'park'
        elif type_filter == 'restaurant':
            google_type = 'restaurant'
        
        # Build Google Places API URL
        url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
        params = {
            'location': f"{center_lat},{center_lng}",
            'radius': radius,
            'type': google_type,
            'key': GOOGLE_MAPS_API_KEY
        }
        
        # Add keyword if provided
        if keyword:
            params['keyword'] = keyword
        
        response = requests.get(url, params=params)
        data = response.json()
        
        if data['status'] == 'OK':
            # Format POIs
            pois = []
            for i, place in enumerate(data['results'][:10]):  # Limit to 10 results
                pois.append({
                    'id': str(i + 1),
                    'name': place['name'],
                    'lat': place['geometry']['location']['lat'],
                    'lng': place['geometry']['location']['lng'],
                    'type': type_filter,
                    'rating': place.get('rating', None),
                    'address': place.get('vicinity', '')
                })
            
            return jsonify({'success': True, 'pois': pois})
        else:
            # If API call fails, use mock data as fallback
            mock_pois = []
            if type_filter == 'restaurant':
                mock_pois = [
                    {"id": "1", "name": "Sample Restaurant 1", "lat": center_lat - 0.01, "lng": center_lng - 0.01, "type": "restaurant", "rating": 4.5, "address": "123 Main St"},
                    {"id": "2", "name": "Sample Restaurant 2", "lat": center_lat + 0.01, "lng": center_lng + 0.01, "type": "restaurant", "rating": 4.2, "address": "456 Elm St"}
                ]
            elif type_filter == 'park':
                mock_pois = [
                    {"id": "3", "name": "Sample Park 1", "lat": center_lat - 0.02, "lng": center_lng + 0.02, "type": "park", "rating": 4.7, "address": "789 Oak St"},
                    {"id": "4", "name": "Sample Park 2", "lat": center_lat + 0.02, "lng": center_lng - 0.02, "type": "park", "rating": 4.1, "address": "321 Pine St"}
                ]
            
            return jsonify({'success': True, 'pois': mock_pois})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/search_places', methods=['POST'])
def search_places():
    """Search for places using Google Places API text search"""
    data = request.json
    query = data.get('query')
    location = data.get('location')  # [lat, lng]
    
    if not query:
        return jsonify({'success': False, 'error': 'Search query is required'})
    
    try:
        # Build Google Places API URL for text search
        url = 'https://maps.googleapis.com/maps/api/place/textsearch/json'
        params = {
            'query': query,
            'key': GOOGLE_MAPS_API_KEY
        }
        
        # Add location bias if provided
        if location:
            params['location'] = f"{location[0]},{location[1]}"
            params['radius'] = 50000  # 50km radius
        
        response = requests.get(url, params=params)
        data = response.json()
        
        if data['status'] == 'OK':
            # Format results
            places = []
            for i, place in enumerate(data['results'][:10]):  # Limit to 10 results
                place_type = 'custom'
                if 'types' in place:
                    if 'restaurant' in place['types']:
                        place_type = 'restaurant'
                    elif 'park' in place['types'] or 'natural_feature' in place['types']:
                        place_type = 'park'
                
                places.append({
                    'id': f"search-{i + 1}",
                    'name': place['name'],
                    'lat': place['geometry']['location']['lat'],
                    'lng': place['geometry']['location']['lng'],
                    'type': place_type,
                    'rating': place.get('rating', None),
                    'address': place.get('formatted_address', '')
                })
            
            return jsonify({'success': True, 'places': places})
        else:
            return jsonify({'success': False, 'error': f"Google Places API error: {data['status']}"})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/adjust_route', methods=['POST'])
def adjust_route():
    """Adjust route to include points of interest using Mapbox Directions API with waypoints"""
    data = request.json
    start = data.get('start')    # [lng, lat]
    end = data.get('end')        # [lng, lat]
    waypoints = data.get('waypoints', [])  # [[lng, lat], ...]
    mode = data.get('mode', 'driving')  # 'driving' or 'walking'
    
    if not start or not end:
        return jsonify({'success': False, 'error': 'Start and end points are required'})
    
    try:
        # Map our travel mode to Mapbox profile
        mapbox_profile = 'mapbox/driving'
        if mode == 'walking':
            mapbox_profile = 'mapbox/walking'
        
        # Format coordinates string with waypoints
        coordinates = f"{start[0]},{start[1]};"
        
        # Add waypoints
        for waypoint in waypoints:
            coordinates += f"{waypoint[0]},{waypoint[1]};"
        
        # Add end point
        coordinates += f"{end[0]},{end[1]}"
        
        url = f"https://api.mapbox.com/directions/v5/{mapbox_profile}/{coordinates}"
        
        params = {
            'access_token': MAPBOX_TOKEN,
            'geometries': 'geojson',
            'overview': 'full'
        }
        
        response = requests.get(url, params=params)
        data = response.json()
        
        if 'routes' in data and len(data['routes']) > 0:
            # Extract the route coordinates
            route_coordinates = data['routes'][0]['geometry']['coordinates']
            distance = data['routes'][0]['distance']
            
            # Recalculate duration based on realistic walking speed (5 km/h = 1.38 m/s)
            # This overrides the API's duration which can sometimes be unrealistic
            if mode == 'walking':
                walking_speed_m_per_s = 1.38  # 5 km/h in meters per second
                duration = distance / walking_speed_m_per_s  # in seconds
                # Add extra time for elevation changes, intersections, etc. (about 10%)
                duration = duration * 1.1
            else:
                duration = data['routes'][0]['duration']  # Use API duration for driving
            
            return jsonify({
                'success': True,
                'path': route_coordinates,
                'distance': distance,
                'duration': duration
            })
        else:
            return jsonify({'success': False, 'error': 'No route found'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/proxy_place_search', methods=['POST'])
def proxy_place_search():
    """Proxy for Google Places API search with bounds support"""
    data = request.json
    query = data.get('query')
    location = data.get('location')  # [lat, lng]
    bounds = data.get('bounds')      # [[sw_lng, sw_lat], [ne_lng, ne_lat]]
    place_type = data.get('type')    # Optional place type for filtering
    
    if not query:
        return jsonify({'success': False, 'error': 'Search query is required'})
    
    try:
        print(f"DEBUG API: Searching for '{query}' with bounds: {bounds}")
        
        # Build Google Places API URL for text search
        url = 'https://maps.googleapis.com/maps/api/place/textsearch/json'
        params = {
            'query': query,
            'key': GOOGLE_MAPS_API_KEY,
            'radius': 50000  # 50km max radius to get more results
        }
        
        # Add location bias if provided
        if location:
            params['location'] = f"{location[0]},{location[1]}"
        
        # Add viewport bounds if provided - this is crucial for map-constrained search
        if bounds and len(bounds) == 2:
            sw = bounds[0]  # [lng, lat]
            ne = bounds[1]  # [lng, lat]
            params['bounds'] = f"{sw[1]},{sw[0]}|{ne[1]},{ne[0]}"  # Format: sw_lat,sw_lng|ne_lat,ne_lng
        
        # Make the API request
        response = requests.get(url, params=params)
        data = response.json()
        print(f"DEBUG API: Places API returned status: {data['status']}, results: {len(data.get('results', []))}")
        
        # For certain generic queries like 'restaurant', also try the nearby search API
        # which often returns more results than text search for generic terms
        if query.lower() in ['restaurant', 'cafe', 'bar', 'park', 'museum', 'hotel', 'store', 'shop'] or 'restaurant' in query.lower():
            print(f"DEBUG API: Using Nearby Search API for generic term: {query}")
            nearby_url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
            nearby_params = {
                'key': GOOGLE_MAPS_API_KEY,
                'radius': 50000
            }
            
            if location:
                nearby_params['location'] = f"{location[0]},{location[1]}"
                
            # Set type for nearby search
            if query.lower() == 'restaurant' or 'restaurant' in query.lower():
                nearby_params['type'] = 'restaurant'
                if 'chinese' in query.lower():
                    nearby_params['keyword'] = 'chinese'
                elif 'indian' in query.lower():
                    nearby_params['keyword'] = 'indian'
                elif 'italian' in query.lower():
                    nearby_params['keyword'] = 'italian'
                elif 'japanese' in query.lower():
                    nearby_params['keyword'] = 'japanese'
                # Add more cuisine types as needed
            elif query.lower() == 'cafe':
                nearby_params['type'] = 'cafe'
            elif query.lower() == 'bar':
                nearby_params['type'] = 'bar'
            elif query.lower() == 'park':
                nearby_params['type'] = 'park'
            elif query.lower() == 'museum':
                nearby_params['type'] = 'museum'
            elif query.lower() == 'hotel':
                nearby_params['type'] = 'lodging'
            elif query.lower() in ['store', 'shop']:
                nearby_params['type'] = 'store'
            
            nearby_response = requests.get(nearby_url, nearby_params)
            nearby_data = nearby_response.json()
            
            # Merge results
            if nearby_data['status'] == 'OK':
                print(f"DEBUG API: Nearby Search returned {len(nearby_data.get('results', []))} results")
                if data['status'] == 'OK':
                    # Add nearby results to text search results
                    data['results'].extend(nearby_data['results'])
                else:
                    data = nearby_data
        
        if data['status'] == 'OK':
            # Collect all places
            all_places = []
            page_count = 1
            
            # Process the first page of results
            print(f"DEBUG API: Processing page {page_count} with {len(data['results'])} results")
            
            # Create a more flexible bounds check - expand the bounds slightly to avoid
            # missing places that are just on the edge
            bounds_expanded = None
            if bounds and len(bounds) == 2:
                sw_lat, sw_lng = bounds[0][1], bounds[0][0]
                ne_lat, ne_lng = bounds[1][1], bounds[1][0]
                
                # Expand bounds by 10%
                lat_diff = abs(ne_lat - sw_lat) * 0.1
                lng_diff = abs(ne_lng - sw_lng) * 0.1
                
                bounds_expanded = {
                    'sw_lat': sw_lat - lat_diff,
                    'sw_lng': sw_lng - lng_diff,
                    'ne_lat': ne_lat + lat_diff,
                    'ne_lng': ne_lng + lng_diff
                }
            
            for i, place in enumerate(data['results']):
                place_type = 'custom'
                if 'types' in place:
                    if 'restaurant' in place['types']:
                        place_type = 'restaurant'
                    elif 'park' in place['types'] or 'natural_feature' in place['types']:
                        place_type = 'park'
                    elif 'cafe' in place['types'] or 'bakery' in place['types']:
                        place_type = 'cafe'
                    elif 'bar' in place['types'] or 'night_club' in place['types']:
                        place_type = 'bar'
                
                # Determine cuisine type if available
                cuisine_type = ''
                if 'chinese' in query.lower() and place_type == 'restaurant':
                    cuisine_type = 'Chinese'
                elif 'indian' in query.lower() and place_type == 'restaurant':
                    cuisine_type = 'Indian'
                elif 'italian' in query.lower() and place_type == 'restaurant':
                    cuisine_type = 'Italian'
                elif 'japanese' in query.lower() and place_type == 'restaurant':
                    cuisine_type = 'Japanese'
                
                # Include this in the description if available
                place_description = ''
                if cuisine_type:
                    place_description = f"{cuisine_type} restaurant"
                
                # Check if the place is within bounds (with expanded bounds)
                if bounds_expanded:
                    lat = place['geometry']['location']['lat']
                    lng = place['geometry']['location']['lng']
                    
                    # Use expanded bounds for checking
                    if not (bounds_expanded['sw_lat'] <= lat <= bounds_expanded['ne_lat'] and 
                            bounds_expanded['sw_lng'] <= lng <= bounds_expanded['ne_lng']):
                        # For restaurants, we'll be less strict with bounds to find more options
                        if 'restaurant' in query.lower() and place_type == 'restaurant':
                            # For restaurants, check if it's within a larger radius (2x expanded bounds)
                            if ((bounds_expanded['sw_lat'] - lat_diff) <= lat <= (bounds_expanded['ne_lat'] + lat_diff) and 
                                (bounds_expanded['sw_lng'] - lng_diff) <= lng <= (bounds_expanded['ne_lng'] + lng_diff)):
                                # Include but mark as outside immediate view
                                place_description = (place_description + " (slightly outside current view)").strip()
                            else:
                                continue
                        else:
                            continue  # Skip this place as it's outside the bounds
                
                all_places.append({
                    'id': f"search-{len(all_places) + 1}",
                    'name': place['name'],
                    'lat': place['geometry']['location']['lat'],
                    'lng': place['geometry']['location']['lng'],
                    'type': place_type,
                    'rating': place.get('rating', None),
                    'address': place.get('formatted_address', '') or place.get('vicinity', ''),
                    'description': place_description
                })
            
            # If there's a next page token and we've got fewer than 60 places, fetch the next page
            while 'next_page_token' in data and len(all_places) < 60:
                page_token = data['next_page_token']
                
                # Google requires a short delay before using a next_page_token
                import time
                time.sleep(1.5)  # Reduced from 2 seconds to speed up searching
                
                # Fetch next page
                next_page_url = f"https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken={page_token}&key={GOOGLE_MAPS_API_KEY}"
                next_page_response = requests.get(next_page_url)
                data = next_page_response.json()
                
                if data['status'] == 'OK':
                    page_count += 1
                    print(f"DEBUG API: Processing page {page_count} with {len(data['results'])} results")
                    
                    for place in data['results']:
                        place_type = 'custom'
                        if 'types' in place:
                            if 'restaurant' in place['types']:
                                place_type = 'restaurant'
                            elif 'park' in place['types'] or 'natural_feature' in place['types']:
                                place_type = 'park'
                            elif 'cafe' in place['types'] or 'bakery' in place['types']:
                                place_type = 'cafe'
                            elif 'bar' in place['types'] or 'night_club' in place['types']:
                                place_type = 'bar'
                        
                        # Determine cuisine type if available
                        cuisine_type = ''
                        if 'chinese' in query.lower() and place_type == 'restaurant':
                            cuisine_type = 'Chinese'
                        elif 'indian' in query.lower() and place_type == 'restaurant':
                            cuisine_type = 'Indian'
                        elif 'italian' in query.lower() and place_type == 'restaurant':
                            cuisine_type = 'Italian'
                        elif 'japanese' in query.lower() and place_type == 'restaurant':
                            cuisine_type = 'Japanese'
                        
                        # Include this in the description if available
                        place_description = ''
                        if cuisine_type:
                            place_description = f"{cuisine_type} restaurant"
                        
                        # Check bounds with the expanded bounds
                        if bounds_expanded:
                            lat = place['geometry']['location']['lat']
                            lng = place['geometry']['location']['lng']
                            
                            # Use expanded bounds for checking
                            if not (bounds_expanded['sw_lat'] <= lat <= bounds_expanded['ne_lat'] and 
                                    bounds_expanded['sw_lng'] <= lng <= bounds_expanded['ne_lng']):
                                # For restaurants, we'll be less strict with bounds to find more options
                                if 'restaurant' in query.lower() and place_type == 'restaurant':
                                    # For restaurants, check if it's within a larger radius (2x expanded bounds)
                                    if ((bounds_expanded['sw_lat'] - lat_diff) <= lat <= (bounds_expanded['ne_lat'] + lat_diff) and 
                                        (bounds_expanded['sw_lng'] - lng_diff) <= lng <= (bounds_expanded['ne_lng'] + lng_diff)):
                                        # Include but mark as outside immediate view
                                        place_description = (place_description + " (slightly outside current view)").strip()
                                    else:
                                        continue
                                else:
                                    continue
                        
                        all_places.append({
                            'id': f"search-{len(all_places) + 1}",
                            'name': place['name'],
                            'lat': place['geometry']['location']['lat'],
                            'lng': place['geometry']['location']['lng'],
                            'type': place_type,
                            'rating': place.get('rating', None),
                            'address': place.get('formatted_address', '') or place.get('vicinity', ''),
                            'description': place_description
                        })
                else:
                    # If we get an error with the next page, just stop paginating
                    print(f"DEBUG API: Error fetching next page: {data['status']}")
                    break
            
            # If it's a restaurant query with cuisine type and we have few results, try a keyword search
            if 'restaurant' in query.lower() and len(all_places) < 5:
                cuisine_keywords = []
                if 'chinese' in query.lower():
                    cuisine_keywords.append('chinese food')
                    cuisine_keywords.append('chinese restaurant')
                if 'indian' in query.lower():
                    cuisine_keywords.append('indian food')
                    cuisine_keywords.append('indian restaurant')
                if 'italian' in query.lower():
                    cuisine_keywords.append('italian food')
                    cuisine_keywords.append('italian restaurant')
                if 'japanese' in query.lower():
                    cuisine_keywords.append('japanese food')
                    cuisine_keywords.append('japanese restaurant')
                
                for keyword in cuisine_keywords:
                    # Try a direct keyword search
                    keyword_url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
                    keyword_params = {
                        'key': GOOGLE_MAPS_API_KEY,
                        'keyword': keyword,
                        'radius': 50000
                    }
                    
                    if location:
                        keyword_params['location'] = f"{location[0]},{location[1]}"
                    
                    print(f"DEBUG API: Trying keyword search for: {keyword}")
                    keyword_response = requests.get(keyword_url, keyword_params)
                    keyword_data = keyword_response.json()
                    
                    if keyword_data['status'] == 'OK':
                        print(f"DEBUG API: Keyword search found {len(keyword_data.get('results', []))} results")
                        for place in keyword_data['results']:
                            # Extract cuisine type from keyword
                            cuisine_type = keyword.split()[0].capitalize()
                            place_description = f"{cuisine_type} restaurant"
                            
                            # Check if it's a duplicate
                            is_duplicate = False
                            for existing_place in all_places:
                                if (existing_place['name'] == place['name'] and 
                                    abs(existing_place['lat'] - place['geometry']['location']['lat']) < 0.0001 and
                                    abs(existing_place['lng'] - place['geometry']['location']['lng']) < 0.0001):
                                    is_duplicate = True
                                    break
                            
                            if not is_duplicate:
                                # Check bounds with more flexibility for restaurants
                                if bounds_expanded:
                                    lat = place['geometry']['location']['lat']
                                    lng = place['geometry']['location']['lng']
                                    
                                    # Use expanded bounds for checking
                                    if not (bounds_expanded['sw_lat'] <= lat <= bounds_expanded['ne_lat'] and 
                                            bounds_expanded['sw_lng'] <= lng <= bounds_expanded['ne_lng']):
                                        # For restaurants, use even larger bounds
                                        if ((bounds_expanded['sw_lat'] - lat_diff*2) <= lat <= (bounds_expanded['ne_lat'] + lat_diff*2) and 
                                            (bounds_expanded['sw_lng'] - lng_diff*2) <= lng <= (bounds_expanded['ne_lng'] + lng_diff*2)):
                                            # Include but mark as outside immediate view
                                            place_description = f"{cuisine_type} restaurant (slightly outside current view)"
                                        else:
                                            continue
                                
                                all_places.append({
                                    'id': f"search-{len(all_places) + 1}",
                                    'name': place['name'],
                                    'lat': place['geometry']['location']['lat'],
                                    'lng': place['geometry']['location']['lng'],
                                    'type': 'restaurant',
                                    'rating': place.get('rating', None),
                                    'address': place.get('vicinity', ''),
                                    'description': place_description
                                })
            
            print(f"DEBUG API: Total places found: {len(all_places)}")
            return jsonify({'success': True, 'places': all_places})
        else:
            error_message = f"Google Places API error: {data['status']}"
            print(f"DEBUG API: {error_message}")
            return jsonify({'success': False, 'error': error_message})
    except Exception as e:
        error_message = str(e)
        print(f"DEBUG API: Exception: {error_message}")
        return jsonify({'success': False, 'error': error_message})

@app.route('/crime_data')
def crime_data():
    """Serve the crime data CSV file"""
    import os
    from flask import send_from_directory, send_file
    
    # Check for the CSV in the route_app directory first
    if os.path.exists('CrimeData.csv'):
        return send_file('CrimeData.csv')
    
    # Then check for file in CODE3234 project
    code3234_path = r'C:\Users\SD\Desktop\CODE3234 - W2 - 2025'
    crime_data_file = os.path.join(code3234_path, 'CrimeData.csv')
    if os.path.exists(crime_data_file):
        return send_file(crime_data_file)
    
    # Finally, use our placeholder
    return send_from_directory('static/data', 'CrimeData.csv')

@app.route('/lga_crime_data')
def lga_crime_data():
    """Return crime data from the LgaRankings_27_Offences.xlsx file"""
    import pandas as pd
    import numpy as np
    import json
    import os
    
    try:
        # Path to the Excel file
        excel_file = 'static/data/LgaRankings_27_Offences.xlsx'
        
        if not os.path.exists(excel_file):
            return jsonify({'success': False, 'error': f'Excel file not found: {excel_file}'})
        
        # First, extract the offense type from the first few rows
        offense_df = pd.read_excel(excel_file, header=None, nrows=3)
        offense_type = None
        for i in range(3):
            val = offense_df.iloc[i, 0]
            if isinstance(val, str) and 'incident' in val.lower():
                offense_type = val
                break
        
        if not offense_type:
            offense_type = "Domestic violence related assault incidents"
            
        # Read all rows from the file to manually process
        raw_df = pd.read_excel(excel_file, header=None)
        
        # Find the header row (containing "Local Government Area")
        header_row_idx = None
        for i in range(raw_df.shape[0]):
            if isinstance(raw_df.iloc[i, 0], str) and 'local government area' in raw_df.iloc[i, 0].lower():
                header_row_idx = i
                break
        
        if header_row_idx is None:
            return jsonify({'success': False, 'error': 'Could not find the header row containing LGA information'})
        
        # Extract header information
        headers = raw_df.iloc[header_row_idx].tolist()
        headers = [str(h).strip() if not pd.isna(h) else f"Column_{i}" for i, h in enumerate(headers)]
        
        # Get data rows (everything after the header)
        data_rows = raw_df.iloc[header_row_idx+1:].copy()
        data_rows.columns = range(data_rows.shape[1])  # Reset column names to indexes
        
        # Process rows into a clean format
        crime_data = []
        for i in range(data_rows.shape[0]):
            row = data_rows.iloc[i]
            lga_name = row[0]
            
            # Skip invalid or non-LGA rows
            if not isinstance(lga_name, str) or pd.isna(lga_name) or lga_name.strip() == '':
                continue
                
            # Skip footnotes, headers, etc.
            if any(x in str(lga_name).lower() for x in ['note:', 'acknowledgement', 'total nsw', 'excludes', 'rates calculated']):
                continue
            
            # Create LGA record
            lga_data = {
                "lga": lga_name,
                "offense": offense_type,
                "metrics": {}
            }
            
            # Extract number, rate, and rank from columns 1-3 if available
            # Column 1 should be Number
            if len(row) > 1 and not pd.isna(row[1]) and row[1] != '':
                lga_data["metrics"]["incidents"] = str(row[1])
            
            # Column 2 should be Rate
            if len(row) > 2 and not pd.isna(row[2]) and row[2] != '':
                lga_data["metrics"]["rate"] = str(row[2])
                
            # Column 3 should be Rank
            if len(row) > 3 and not pd.isna(row[3]) and row[3] != '':
                lga_data["metrics"]["rank"] = str(row[3])
            
            crime_data.append(lga_data)
        
        # Sort by LGA name
        crime_data.sort(key=lambda x: x['lga'])
        
        # Sample data for debugging
        sample_data = crime_data[:5] if crime_data else []
        
        return jsonify({
            'success': True,
            'offense': offense_type,
            'crime_data': crime_data,
            'sample': sample_data
        })
        
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        })

@app.route('/geocode_autocomplete', methods=['POST'])
def geocode_autocomplete():
    data = request.json
    query = data.get('query', '')
    location = data.get('location', [-33.8688, 151.2093])  # Default to Sydney
    country = data.get('country', 'au')  # Default to Australia
    region = data.get('region', 'nsw')  # Default to New South Wales
    
    if not query:
        return jsonify({'success': False, 'error': 'No query provided'})
    
    try:
        # Construct parameters for Mapbox geocoding API
        params = {
            'access_token': os.environ.get('MAPBOX_TOKEN'),
            'autocomplete': 'true',
            'country': country,
            'proximity': f'{location[1]},{location[0]}',  # lng,lat format for Mapbox
            'types': 'address,place,poi',
            'limit': 5
        }
        
        # Add region bias if provided
        if region:
            params['region'] = region
            
        # Make request to Mapbox geocoding API
        response = requests.get(
            f'https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json',
            params=params
        )
        
        if response.status_code != 200:
            return jsonify({'success': False, 'error': f'Geocoding API error: {response.status_code}'})
        
        results = response.json()
        
        # Process and format the suggestions
        suggestions = []
        for feature in results.get('features', []):
            suggestions.append({
                'name': feature.get('place_name', ''),
                'lng': feature['geometry']['coordinates'][0],
                'lat': feature['geometry']['coordinates'][1],
                'id': feature.get('id', '')
            })
        
        return jsonify({
            'success': True,
            'suggestions': suggestions
        })
    
    except Exception as e:
        app.logger.error(f"Autocomplete error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/street_lamps', methods=['POST'])
def get_street_lamps():
    """Query for street lamps data along a route from OpenStreetMap"""
    data = request.json
    bbox = data.get('bbox')
    
    if not bbox:
        return jsonify({"success": False, "error": "Missing bounding box"})
    
    try:
        # Construct Overpass API query to get street lamps
        query = f"""
            [out:json];
            (
              node["highway"="street_lamp"]({bbox});
            );
            out body;
        """
        
        # Fetch street lamps data from Overpass API
        response = requests.post('https://overpass-api.de/api/interpreter', data=query)
        
        if not response.ok:
            return jsonify({"success": False, "error": "Failed to fetch street lamp data"})
        
        lamp_data = response.json()
        
        # Convert OSM data to GeoJSON
        features = []
        for element in lamp_data.get('elements', []):
            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [element.get('lon'), element.get('lat')]
                },
                "properties": {
                    "id": element.get('id'),
                    "tags": element.get('tags', {})
                }
            }
            features.append(feature)
        
        geojson = {
            "type": "FeatureCollection",
            "features": features
        }
        
        return jsonify({
            "success": True,
            "count": len(features),
            "data": geojson
        })
    except Exception as e:
        print(f"Error fetching street lamps: {e}")
        return jsonify({"success": False, "error": str(e)})

if __name__ == '__main__':
    app.run(debug=True) 