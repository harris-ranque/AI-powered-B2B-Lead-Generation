import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
} from "react";
import type { PipelineState, PipelineStage, LeadSourceType } from "./types";
import type { Lead, EmailGenerationResult } from "@/lib/api-client";
import type { Id } from "@genni/convex-types/dataModel";

interface PipelineAction {
  type:
    | "SET_STAGE"
    | "SET_SOURCE"
    | "SET_SEARCH_ID"
    | "SET_LEADS"
    | "SET_ENRICHED_LEADS"
    | "SET_EMAILS"
    | "SET_PROCESSING"
    | "MARK_STAGE_COMPLETE"
    | "RESET_PIPELINE";
  payload?:
    | PipelineStage
    | LeadSourceType
    | Id<"searches">
    | Lead[]
    | EmailGenerationResult[]
    | boolean
    | null;
}

const initialState: PipelineState = {
  currentStage: "source_selection",
  completedStages: [],
  selectedSource: null,
  searchId: null,
  leads: [],
  enrichedLeads: [],
  generatedEmails: [],
  canProgress: false,
  isProcessing: false,
};

function pipelineReducer(
  state: PipelineState,
  action: PipelineAction,
): PipelineState {
  switch (action.type) {
    case "SET_STAGE":
      return { ...state, currentStage: action.payload };

    case "SET_SOURCE":
      return {
        ...state,
        selectedSource: action.payload,
        canProgress: action.payload !== null,
      };

    case "SET_SEARCH_ID":
      return { ...state, searchId: action.payload };

    case "SET_LEADS":
      return { ...state, leads: action.payload };

    case "SET_ENRICHED_LEADS":
      return { ...state, enrichedLeads: action.payload };

    case "SET_EMAILS":
      return { ...state, generatedEmails: action.payload };

    case "SET_PROCESSING":
      return { ...state, isProcessing: action.payload };

    case "MARK_STAGE_COMPLETE": {
      const newCompletedStages = [...state.completedStages];
      if (!newCompletedStages.includes(action.payload as PipelineStage)) {
        newCompletedStages.push(action.payload as PipelineStage);
      }
      return { ...state, completedStages: newCompletedStages };
    }

    case "RESET_PIPELINE":
      return { ...initialState };

    default:
      return state;
  }
}

interface PipelineContextType {
  state: PipelineState;
  setStage: (stage: PipelineStage) => void;
  setSource: (source: LeadSourceType) => void;
  setSearchId: (searchId: Id<"searches">) => void;
  setLeads: (leads: Lead[]) => void;
  setEnrichedLeads: (leads: Lead[]) => void;
  setEmails: (emails: EmailGenerationResult[]) => void;
  setProcessing: (processing: boolean) => void;
  markStageComplete: (stage: PipelineStage) => void;
  resetPipeline: () => void;
  canProgressToStage: (stage: PipelineStage) => boolean;
  progressToNextStage: () => void;
}

const PipelineContext = createContext<PipelineContextType | undefined>(
  undefined,
);

export function PipelineProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(pipelineReducer, initialState);

  const setStage = useCallback((stage: PipelineStage) => {
    dispatch({ type: "SET_STAGE", payload: stage });
  }, []);

  const setSource = useCallback((source: LeadSourceType) => {
    dispatch({ type: "SET_SOURCE", payload: source });
  }, []);

  const setSearchId = useCallback((searchId: Id<"searches">) => {
    dispatch({ type: "SET_SEARCH_ID", payload: searchId });
  }, []);

  const setLeads = useCallback((leads: Lead[]) => {
    dispatch({ type: "SET_LEADS", payload: leads });
  }, []);

  const setEnrichedLeads = useCallback((leads: Lead[]) => {
    dispatch({ type: "SET_ENRICHED_LEADS", payload: leads });
  }, []);

  const setEmails = useCallback((emails: EmailGenerationResult[]) => {
    dispatch({ type: "SET_EMAILS", payload: emails });
  }, []);

  const setProcessing = useCallback((processing: boolean) => {
    dispatch({ type: "SET_PROCESSING", payload: processing });
  }, []);

  const markStageComplete = useCallback((stage: PipelineStage) => {
    dispatch({ type: "MARK_STAGE_COMPLETE", payload: stage });
  }, []);

  const resetPipeline = useCallback(() => {
    dispatch({ type: "RESET_PIPELINE" });
  }, []);

  const canProgressToStage = useCallback(
    (stage: PipelineStage) => {
      const stageOrder: PipelineStage[] = [
        "source_selection",
        "lead_discovery",
        "enrichment",
        "ai_personalization",
        "review_export",
      ];

      const targetIndex = stageOrder.indexOf(stage);
      const currentIndex = stageOrder.indexOf(state.currentStage);

      // Can always go backward
      if (targetIndex <= currentIndex) return true;

      // Can only go forward if previous stages are complete
      for (let i = 0; i < targetIndex; i++) {
        if (!state.completedStages.includes(stageOrder[i])) {
          return false;
        }
      }

      return true;
    },
    [state.currentStage, state.completedStages],
  );

  const progressToNextStage = useCallback(() => {
    const stageOrder: PipelineStage[] = [
      "source_selection",
      "lead_discovery",
      "enrichment",
      "ai_personalization",
      "review_export",
    ];

    const currentIndex = stageOrder.indexOf(state.currentStage);
    if (currentIndex < stageOrder.length - 1) {
      const nextStage = stageOrder[currentIndex + 1];
      if (canProgressToStage(nextStage)) {
        setStage(nextStage);
      }
    }
  }, [state.currentStage, canProgressToStage, setStage]);

  const value: PipelineContextType = {
    state,
    setStage,
    setSource,
    setSearchId,
    setLeads,
    setEnrichedLeads,
    setEmails,
    setProcessing,
    markStageComplete,
    resetPipeline,
    canProgressToStage,
    progressToNextStage,
  };

  return (
    <PipelineContext.Provider value={value}>
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipeline() {
  const context = useContext(PipelineContext);
  if (context === undefined) {
    throw new Error("usePipeline must be used within a PipelineProvider");
  }
  return context;
}
