import { Check, ChevronsUpDown, Plus, Store } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useCurrentLocation } from "@/hooks/useLocations";
import { useTenantRole } from "@/hooks/useTenant";

export const LocationSwitcher = () => {
  const [open, setOpen] = useState(false);
  const { currentLocation, locations, setCurrentLocationId } = useCurrentLocation();
  const role = useTenantRole();
  const navigate = useNavigate();

  if (locations.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-none h-auto py-3 px-4"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Store className="w-3.5 h-3.5 stroke-[1.5] flex-shrink-0 text-gold" />
            <div className="flex flex-col items-start min-w-0">
              <span className="eyebrow text-[9px] text-sidebar-foreground/40">Location</span>
              <span className="font-serif text-[13px] tracking-wider truncate max-w-[140px]">
                {currentLocation?.name ?? "選択..."}
              </span>
            </div>
          </div>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandList>
            <CommandEmpty>店舗が見つかりません</CommandEmpty>
            <CommandGroup heading="店舗を選択">
              {locations.map((loc) => (
                <CommandItem
                  key={loc.id}
                  value={loc.id}
                  onSelect={() => {
                    setCurrentLocationId(loc.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      currentLocation?.id === loc.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm">{loc.name}</span>
                    {loc.is_primary && (
                      <span className="text-[10px] text-muted-foreground">本店</span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {(role === "owner" || role === "super_admin") && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      setOpen(false);
                      navigate("/locations");
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    <span>店舗を管理</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
