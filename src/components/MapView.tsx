import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Polygon, useMapEvents, CircleMarker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { renderToString } from 'react-dom/server';
import { Car, Plane, Ship, Footprints, Shield, HeartPulse, Tent, Crosshair } from 'lucide-react';

// Fix for default marker icons in react-leaflet in some Vite setups
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// A custom red icon for the outbreak start
const outbreakIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

export interface MapData {
  infected?: [number, number][];
  movements?: {
    from: [number, number];
    to: [number, number];
    type: string;
  }[];
  pois?: {
    lat: number;
    lng: number;
    type: string;
    label?: string;
  }[];
  perimeters?: {
    points: [number, number][];
    type: string;
    label?: string;
  }[];
}

interface MapViewProps {
  location: [number, number];
  setLocation: (loc: [number, number]) => void;
  mapData?: MapData;
  showOverlay?: boolean;
}

function LocationMarker({ location, setLocation }: MapViewProps) {
  useMapEvents({
    click(e) {
      setLocation([e.latlng.lat, e.latlng.lng]);
    },
  });

  return location ? (
    <Marker position={location} icon={outbreakIcon} />
  ) : null;
}

const getMovementIcon = (type: string) => {
  const iconStyle = "color: #EF4444; width: 16px; height: 16px; drop-shadow(0 0 2px black)";
  let IconComponent = Car;
  if (type === 'plane') IconComponent = Plane;
  if (type === 'ship') IconComponent = Ship;
  if (type === 'foot') IconComponent = Footprints;

  const html = renderToString(<IconComponent style={{ color: '#EF4444', width: '16px', height: '16px', filter: 'drop-shadow(0 0 2px black)' }} />);
  
  return new L.DivIcon({
    html: `<div style="display:flex; align-items:center; justify-content:center; background:#111; border:1px solid #333; border-radius:50%; width:24px; height:24px;">${html}</div>`,
    className: 'custom-movement-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

const getArrowIcon = (angle: number) => {
  return new L.DivIcon({
    html: `<div style="transform: rotate(${angle}deg); display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; filter: drop-shadow(0 0 2px black);">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v20M17 7l-5-5-5 5"/>
      </svg>
    </div>`,
    className: 'custom-arrow-icon',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
};

const getPoiIcon = (type: string) => {
  let IconComponent = Shield;
  let color = '#3B82F6';
  
  if (type === 'military_base') {
    IconComponent = Shield;
    color = '#10B981';
  } else if (type === 'military_clinic') {
    IconComponent = Tent;
    color = '#F59E0B';
  } else if (type === 'clinic') {
    IconComponent = HeartPulse;
    color = '#3B82F6';
  } else {
    IconComponent = Crosshair;
    color = '#A855F7';
  }

  const html = renderToString(<IconComponent style={{ color, width: '16px', height: '16px', filter: 'drop-shadow(0 0 2px black)' }} />);
  
  return new L.DivIcon({
    html: `<div style="display:flex; align-items:center; justify-content:center; background:#111; border:1px solid ${color}; border-radius:50%; width:24px; height:24px;">${html}</div>`,
    className: 'custom-poi-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

export function MapView({ location, setLocation, mapData, showOverlay = true }: MapViewProps) {
  return (
    <div className="w-full h-full bg-zinc-900 border-r border-zinc-800 relative z-0">
      <MapContainer
        center={location}
        zoom={4}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CartoDB</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <LocationMarker location={location} setLocation={setLocation} />

        {showOverlay && mapData?.infected?.map((pos, idx) => (
          <CircleMarker 
            key={`inf-${idx}`} 
            center={pos} 
            radius={6} 
            pathOptions={{ color: '#EF4444', fillColor: '#EF4444', fillOpacity: 0.4 }} 
          >
            <Tooltip>Заражение</Tooltip>
          </CircleMarker>
        ))}

        {showOverlay && mapData?.movements?.map((mov, idx) => {
          const dy = mov.to[0] - mov.from[0];
          const dx = mov.to[1] - mov.from[1];
          let angle = Math.atan2(dx, dy) * 180 / Math.PI;

          const midPoint: [number, number] = [
            (mov.from[0] + mov.to[0]) / 2,
            (mov.from[1] + mov.to[1]) / 2
          ];
          
          return (
            <div key={`mov-${idx}`}>
              <Polyline positions={[mov.from, mov.to]} pathOptions={{ color: '#EF4444', dashArray: '5, 5', weight: 2, opacity: 0.7 }} />
              <Marker position={midPoint} icon={getMovementIcon(mov.type)}>
                <Tooltip direction="top">Транспорт: {mov.type}</Tooltip>
              </Marker>
              <Marker position={mov.to} icon={getArrowIcon(angle)} />
            </div>
          );
        })}

        {showOverlay && mapData?.pois?.map((poi, idx) => (
          <Marker 
            key={`poi-${idx}`} 
            position={[poi.lat, poi.lng]} 
            icon={getPoiIcon(poi.type)}
          >
            <Tooltip>{poi.label || poi.type}</Tooltip>
          </Marker>
        ))}

        {showOverlay && mapData?.perimeters?.map((perimeter, idx) => (
          <Polygon 
            key={`perim-${idx}`} 
            positions={perimeter.points} 
            pathOptions={{ color: '#10B981', fillColor: '#10B981', fillOpacity: 0.2, weight: 2, dashArray: '4, 4' }} 
          >
            <Tooltip>{perimeter.label || perimeter.type}</Tooltip>
          </Polygon>
        ))}

      </MapContainer>
      <div className="absolute top-4 left-4 z-[1000] pointer-events-none">
        <div className="bg-black/60 backdrop-blur-sm border border-red-900/50 text-red-500 font-mono text-xs uppercase px-3 py-1 rounded">
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block mr-2 animate-pulse"></span>
          Система геолокации активна. Нажмите на карту для выбора очага поражения.
        </div>
      </div>
    </div>
  );
}
