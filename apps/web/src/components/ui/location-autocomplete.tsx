import * as React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { Loader } from "@googlemaps/js-api-loader";
import { MapPin, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Google Places types
interface PlacePrediction {
  description: string;
  place_id: string;
  structured_formatting: {
    main_text: string;
    secondary_text?: string;
  };
  types: string[];
}

interface LocationDetails {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText?: string;
  types: string[];
}

interface LocationAutocompleteProps {
  value?: string;
  placeholder?: string;
  onLocationSelect?: (location: LocationDetails) => void;
  onValueChange?: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

let googleMapsLoader: Loader | null = null;
let autocompleteService: google.maps.places.AutocompleteService | null = null;

// Initialize Google Maps API
const initializeGoogleMaps = async (): Promise<google.maps.places.AutocompleteService> => {
  if (autocompleteService) {
    return autocompleteService;
  }

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  
  // Debug logging for production
  if (import.meta.env.MODE === 'production') {
    console.log('Google Maps API Key check:', {
      hasKey: !!apiKey,
      keyLength: apiKey?.length,
      keyPrefix: apiKey?.substring(0, 10) + '...',
      allEnvKeys: Object.keys(import.meta.env)
    });
  }
  
  if (!apiKey || apiKey === 'undefined' || apiKey === 'your_google_maps_api_key_here') {
    throw new Error("Google Maps API key not configured. Please set VITE_GOOGLE_MAPS_API_KEY in your environment variables.");
  }

  if (!googleMapsLoader) {
    googleMapsLoader = new Loader({
      apiKey,
      version: "weekly",
      libraries: ["places"],
    });
  }

  try {
    await googleMapsLoader.load();
    autocompleteService = new google.maps.places.AutocompleteService();
    return autocompleteService;
  } catch (error) {
    console.error("Failed to initialize Google Maps:", error);
    throw new Error("Failed to load Google Maps API");
  }
};

export const LocationAutocomplete = React.forwardRef<
  HTMLInputElement,
  LocationAutocompleteProps
>(
  (
    {
      value = "",
      placeholder = "Search for a location...",
      onLocationSelect,
      onValueChange,
      className,
      disabled = false,
      ...props
    },
    ref
  ) => {
    const [inputValue, setInputValue] = useState(value);
    const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const debounceRef = useRef<NodeJS.Timeout>();
    const serviceRef = useRef<google.maps.places.AutocompleteService | null>(null);

    // Initialize Google Maps service
    useEffect(() => {
      const initService = async () => {
        try {
          serviceRef.current = await initializeGoogleMaps();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to initialize location service");
        }
      };
      
      initService();
    }, []);

    // Debounced search function
    const searchPredictions = useCallback(async (query: string) => {
      if (!query.trim() || !serviceRef.current) {
        setPredictions([]);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const request: google.maps.places.AutocompletionRequest = {
          input: query,
          types: ['(cities)'], // Focus on cities and administrative areas
          fields: ['place_id', 'description', 'types'],
        };

        serviceRef.current.getPlacePredictions(request, (predictions, status) => {
          setIsLoading(false);
          
          if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
            setPredictions(predictions);
            setIsOpen(true);
          } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            setPredictions([]);
            setIsOpen(false);
          } else {
            console.error("Places service error:", status);
            setError("Failed to fetch location suggestions");
            setPredictions([]);
            setIsOpen(false);
          }
        });
      } catch (err) {
        setIsLoading(false);
        setError("Failed to search locations");
        console.error("Autocomplete error:", err);
      }
    }, []);

    // Handle input change with debouncing
    const handleInputChange = useCallback((newValue: string) => {
      setInputValue(newValue);
      onValueChange?.(newValue);

      // Clear previous timeout
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Debounce the search
      debounceRef.current = setTimeout(() => {
        searchPredictions(newValue);
      }, 300);
    }, [onValueChange, searchPredictions]);

    // Handle location selection
    const handleLocationSelect = useCallback((prediction: PlacePrediction) => {
      const locationDetails: LocationDetails = {
        placeId: prediction.place_id,
        description: prediction.description,
        mainText: prediction.structured_formatting.main_text,
        secondaryText: prediction.structured_formatting.secondary_text,
        types: prediction.types,
      };

      setInputValue(prediction.description);
      setIsOpen(false);
      setPredictions([]);
      onValueChange?.(prediction.description);
      onLocationSelect?.(locationDetails);
    }, [onLocationSelect, onValueChange]);

    // Clear input
    const handleClear = useCallback(() => {
      setInputValue("");
      setIsOpen(false);
      setPredictions([]);
      setError(null);
      onValueChange?.("");
    }, [onValueChange]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }, []);

    // Sync with external value changes
    useEffect(() => {
      if (value !== inputValue) {
        setInputValue(value);
      }
    }, [value, inputValue]);

    // Cleanup debounce on unmount
    useEffect(() => {
      return () => {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
      };
    }, []);

    return (
      <Popover open={isOpen && !disabled} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <div className={cn("relative", className)}>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                ref={ref}
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                className="pl-10 pr-10"
                {...props}
              />
              <div className="absolute right-2 top-2 flex items-center gap-1">
                {isLoading && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {inputValue && !disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 hover:bg-transparent"
                    onClick={handleClear}
                  >
                    <X className="h-3 w-3" />
                    <span className="sr-only">Clear</span>
                  </Button>
                )}
              </div>
            </div>
            {error && (
              <p className="mt-1 text-sm text-destructive">{error}</p>
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent 
          className="w-[var(--radix-popover-trigger-width)] p-0" 
          align="start"
          sideOffset={4}
        >
          <Command>
            <CommandList>
              {predictions.length === 0 && !isLoading ? (
                <CommandEmpty>
                  {inputValue.trim() ? "No locations found." : "Start typing to search locations"}
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {predictions.map((prediction) => (
                    <CommandItem
                      key={prediction.place_id}
                      value={prediction.description}
                      onSelect={() => handleLocationSelect(prediction)}
                      className="flex items-start gap-2 p-2"
                    >
                      <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {prediction.structured_formatting.main_text}
                        </span>
                        {prediction.structured_formatting.secondary_text && (
                          <span className="text-sm text-muted-foreground">
                            {prediction.structured_formatting.secondary_text}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }
);

LocationAutocomplete.displayName = "LocationAutocomplete";