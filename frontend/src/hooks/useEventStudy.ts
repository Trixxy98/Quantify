import { useQuery } from "@tanstack/react-query";
import { getEventStudy, type EventStudyQuery } from "../api/events.api";

export function useEventStudy(query: EventStudyQuery) {
  const symbols = query.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const ready = symbols.length > 0 && symbols.every((s) => /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(s));

  return useQuery({
    queryKey: ["events", "study", symbols, query.type, query.pre, query.post, query.years, query.hold],
    queryFn: () => getEventStudy({...query, symbols}),
    enabled: ready,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
