"""
Data validation utilities for lead research system.
Validates base data collection requirements before triggering deep research.
"""

import re
from typing import Dict, List, Any, Optional, Tuple
from pydantic import BaseModel, Field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .research_clients import ResearchResult
from .logger import setup_logger

logger = setup_logger(__name__)

class DataValidationResult(BaseModel):
    """Result of data validation for a research result"""
    has_all_required_data: bool = Field(..., description="Whether all 5 required data points are present")
    missing_data_points: List[str] = Field(default_factory=list, description="List of missing data points")
    data_point_scores: Dict[str, bool] = Field(default_factory=dict, description="Individual data point validation results")
    validation_score: float = Field(..., ge=0, le=1, description="Overall data completeness score (0-1)")
    
class BaseDataValidator:
    """
    Validates if research results contain the 5 required base data points:
    1. Annual revenue
    2. Employee count  
    3. Leadership names
    4. Recent company news (≤6mo)
    5. Funding/investments
    """
    
    REQUIRED_DATA_POINTS = {
        "annual_revenue": "Annual revenue information",
        "employee_count": "Employee count or company size", 
        "leadership_names": "Leadership names or key executives",
        "recent_news": "Recent company news (within 6 months)",
        "funding_investments": "Funding history or investment information"
    }
    
    def __init__(self):
        # Revenue detection patterns
        self.revenue_patterns = [
            r'\$[\d,]+(?:\.\d+)?\s*(?:million|billion|M|B)',
            r'revenue.*\$[\d,]+',
            r'annual.*revenue',
            r'sales.*\$[\d,]+',
            r'turnover.*\$[\d,]+',
            r'earnings.*\$[\d,]+',
            r'income.*\$[\d,]+',
        ]
        
        # Employee count patterns
        self.employee_patterns = [
            r'\d+\s*(?:employees|staff|workers|people)',
            r'team.*\d+',
            r'workforce.*\d+',
            r'employs.*\d+',
            r'staff.*\d+',
            r'small|medium|large.*(?:company|business)',
            r'startup|enterprise|corporation',
        ]
        
        # Leadership patterns
        self.leadership_patterns = [
            r'CEO|CTO|CFO|COO|president|founder|director',
            r'chief.*officer',
            r'executive.*team',
            r'leadership.*team',
            r'founded.*by',
            r'led.*by',
            r'managed.*by',
        ]
        
        # Recent news patterns (looking for time indicators)
        self.recent_news_patterns = [
            r'202[3-5]',  # Recent years
            r'recent|latest|new|just|announced',
            r'this.*(?:year|month|quarter)',
            r'launched|released|unveiled',
            r'partnership|acquisition|funding',
            r'news|press.*release',
        ]
        
        # Funding patterns
        self.funding_patterns = [
            r'funding|investment|round|series|seed',
            r'raised.*\$[\d,]+',
            r'investors?|venture|capital',
            r'valuation.*\$[\d,]+',
            r'IPO|public|private.*equity',
            r'backed.*by',
            r'financed.*by',
        ]
    
    def validate_research_result(self, result: "ResearchResult") -> DataValidationResult:
        """
        Validate if research result contains all required base data points.
        
        Args:
            result: ResearchResult to validate
            
        Returns:
            DataValidationResult with validation details
        """
        logger.info(f"Validating data completeness for research tier: {result.tier.value}")

        # Check each required data point using structured fields first, then fallback to text analysis
        data_point_scores = {}

        # Check structured fields first (preferred for Perplexity results)
        data_point_scores["annual_revenue"] = bool(result.annual_revenue and result.annual_revenue != "")
        data_point_scores["employee_count"] = bool(result.employee_count and result.employee_count != "")
        data_point_scores["leadership_names"] = bool(result.leadership_names and len(result.leadership_names) > 0)
        data_point_scores["recent_news"] = bool(result.recent_news and len(result.recent_news) > 0)
        data_point_scores["funding_investments"] = bool(result.funding_investments and result.funding_investments != "")

        # Fallback to text-based checking if structured fields are empty (for Tavily results)
        if not any(data_point_scores.values()):
            content_text = self._extract_all_text(result)
            data_point_scores["annual_revenue"] = self._check_annual_revenue(content_text)
            data_point_scores["employee_count"] = self._check_employee_count(content_text)
            data_point_scores["leadership_names"] = self._check_leadership_names(content_text)
            data_point_scores["recent_news"] = self._check_recent_news(content_text, result)
            data_point_scores["funding_investments"] = self._check_funding_investments(content_text)
        
        # Calculate missing data points
        missing_data_points = [
            self.REQUIRED_DATA_POINTS[key] 
            for key, present in data_point_scores.items() 
            if not present
        ]
        
        # Calculate validation score
        validation_score = sum(data_point_scores.values()) / len(data_point_scores)
        
        # Determine if all required data is present
        has_all_required_data = len(missing_data_points) == 0
        
        logger.info(f"Data validation complete: {len(data_point_scores) - len(missing_data_points)}/5 data points present")
        
        return DataValidationResult(
            has_all_required_data=has_all_required_data,
            missing_data_points=missing_data_points,
            data_point_scores=data_point_scores,
            validation_score=validation_score
        )
    
    def _extract_all_text(self, result: "ResearchResult") -> str:
        """Extract all text content from research result for analysis"""
        text_parts = []
        
        # Main content
        if result.company_overview:
            text_parts.append(result.company_overview)
            
        if result.industry_insights:
            text_parts.append(result.industry_insights)
            
        # Services and products
        if result.services_products:
            text_parts.extend(result.services_products)
            
        # Competitor descriptions
        for competitor in result.competitors:
            if isinstance(competitor, dict) and "description" in competitor:
                text_parts.append(competitor["description"])
                
        # Raw data content
        if result.raw_data:
            # Extract text from various raw data structures
            if "comprehensive_report" in result.raw_data:
                text_parts.append(str(result.raw_data["comprehensive_report"]))
            if "langchain_tavily_result" in result.raw_data:
                tavily_data = result.raw_data["langchain_tavily_result"]
                if "answer" in tavily_data:
                    text_parts.append(str(tavily_data["answer"]))
                if "results" in tavily_data:
                    for item in tavily_data["results"]:
                        if isinstance(item, dict) and "content" in item:
                            text_parts.append(str(item["content"]))
        
        return " ".join(text_parts).lower()
    
    def _check_annual_revenue(self, content_text: str) -> bool:
        """Check if annual revenue information is present"""
        for pattern in self.revenue_patterns:
            if re.search(pattern, content_text, re.IGNORECASE):
                return True
        return False
    
    def _check_employee_count(self, content_text: str) -> bool:
        """Check if employee count or company size information is present"""
        for pattern in self.employee_patterns:
            if re.search(pattern, content_text, re.IGNORECASE):
                return True
        return False
    
    def _check_leadership_names(self, content_text: str) -> bool:
        """Check if leadership names or executive information is present"""
        for pattern in self.leadership_patterns:
            if re.search(pattern, content_text, re.IGNORECASE):
                return True
        return False
    
    def _check_recent_news(self, content_text: str, result: "ResearchResult") -> bool:
        """Check if recent company news (within 6 months) is present"""
        # Check for recent news patterns
        for pattern in self.recent_news_patterns:
            if re.search(pattern, content_text, re.IGNORECASE):
                return True
                
        # Check for news in raw data recent_news field
        if result.raw_data and "recent_news" in result.raw_data:
            recent_news = result.raw_data["recent_news"]
            if isinstance(recent_news, list) and len(recent_news) > 0:
                return True
                
        return False
    
    def _check_funding_investments(self, content_text: str) -> bool:
        """Check if funding or investment information is present"""
        for pattern in self.funding_patterns:
            if re.search(pattern, content_text, re.IGNORECASE):
                return True
        return False
    
    def should_trigger_deep_research(self,
                                   validation_result: DataValidationResult,
                                   confidence_score: float = 1.0) -> tuple[bool, str]:
        """
        Trigger deep research based ONLY on data quality after Sonar Pro.

        Deep research escalation triggers when EITHER:
        - Missing 2+ of 5 required data points after Sonar Pro, OR
        - Confidence score < 0.6 after Sonar Pro

        With Sonar Pro providing comprehensive research, deep research should only
        be needed for ~10-15% of leads with incomplete or low-confidence data.

        Args:
            validation_result: Result from validate_research_result
            confidence_score: Research confidence score (adjusted by validation)

        Returns:
            Tuple of (should_trigger, reason)
        """
        from ..config import DEEP_RESEARCH_CONFIG

        # Check if deep research is globally enabled
        if not DEEP_RESEARCH_CONFIG['ENABLED']:
            return False, "Deep research is currently disabled"

        min_missing = DEEP_RESEARCH_CONFIG['MIN_MISSING_DATA_POINTS']
        data_threshold = DEEP_RESEARCH_CONFIG['DATA_COMPLETENESS_THRESHOLD']
        confidence_threshold = DEEP_RESEARCH_CONFIG['CONFIDENCE_THRESHOLD']

        # PRIORITY: If we have all 5 data points, DON'T escalate
        # The structured data is what matters for email personalization, not confidence score
        if validation_result.has_all_required_data:
            logger.info(
                f"Skipping Deep Research - all 5/5 data points present "
                f"(confidence {confidence_score:.2f} is secondary when data is complete)"
            )
            return False, "All 5 data points present - Deep Research not needed"

        # Check if missing 2+ data points after Sonar Pro
        if len(validation_result.missing_data_points) >= min_missing:
            return True, (
                f"Missing {len(validation_result.missing_data_points)}/5 data points "
                f"after Sonar Pro - comprehensive research needed"
            )

        # Only check confidence if we're missing 1 data point
        # (missing 0 is caught above, missing 2+ is caught above)
        if confidence_score < confidence_threshold:
            return True, (
                f"Low confidence ({confidence_score:.2f}) with {len(validation_result.missing_data_points)} "
                f"missing data point(s) - additional research depth needed"
            )

        # Sonar Pro research was sufficient
        return False, "Sonar Pro research sufficient"

    def validate_research_relevance(self,
                                   result: "ResearchResult",
                                   company_name: str,
                                   industry: Optional[str] = None) -> tuple[float, List[str]]:
        """
        Validate if research is actually relevant to the target company.
        Prevents garbage research results from being used in email generation.

        Args:
            result: ResearchResult to validate
            company_name: Target company name
            industry: Target company industry (optional)

        Returns:
            Tuple of (relevance_score, warning_messages)
            - relevance_score: 0.0-1.0 (0.7+ is good, <0.5 is poor)
            - warning_messages: List of relevance issues found
        """
        warnings = []
        relevance_score = 1.0

        # Extract all text content for analysis
        content_text = self._extract_all_text(result).lower()
        company_name_lower = company_name.lower()

        # Remove common business suffixes for matching
        company_core = re.sub(r'\s+(inc|llc|ltd|corp|corporation|company|co)\.?$', '', company_name_lower, flags=re.IGNORECASE)

        # Check 1: Company name appears in research (most important)
        company_mentions = content_text.count(company_core)
        if company_mentions == 0:
            relevance_score -= 0.4
            warnings.append(f"Company name '{company_name}' not found in research content")
        elif company_mentions < 3:
            relevance_score -= 0.2
            warnings.append(f"Company name only mentioned {company_mentions} times (low relevance)")

        # Check 2: Detect obviously wrong content
        wrong_content_indicators = [
            (r'job losses in basic industries', 'Labor/employment article (not company-specific)'),
            (r'full text of ["\']', 'Generic document dump (not research)'),
            (r'massive job losses', 'Generic economic article (not relevant)'),
            (r'part.?time and contractual employment', 'Generic employment article (not company research)'),
            (r'this page intentionally left blank', 'Empty/placeholder content'),
            (r'error|not found|404', 'Error page content'),
            (r'cookie policy|privacy policy|terms of service', 'Website boilerplate (not research)'),
        ]

        for pattern, description in wrong_content_indicators:
            if re.search(pattern, content_text, re.IGNORECASE):
                relevance_score -= 0.3
                warnings.append(f"Irrelevant content detected: {description}")
                break  # Only penalize once for wrong content

        # Check 3: Industry relevance (if provided)
        if industry:
            industry_lower = industry.lower()
            # Remove generic words for better matching
            industry_keywords = [word for word in industry_lower.split()
                               if word not in ['services', 'company', 'inc', 'llc', 'and', 'the', 'of']]

            industry_matches = sum(1 for keyword in industry_keywords if keyword in content_text)
            if len(industry_keywords) > 0 and industry_matches == 0:
                relevance_score -= 0.2
                warnings.append(f"Industry '{industry}' not reflected in research content")

        # Check 4: Minimum content quality
        if len(content_text) < 100:
            relevance_score -= 0.3
            warnings.append(f"Research content too short ({len(content_text)} chars) - likely incomplete")

        # Check 5: Has actual business information
        business_indicators = [
            'revenue', 'employee', 'founded', 'ceo', 'product', 'service',
            'customer', 'client', 'market', 'industry', 'business', 'company'
        ]
        business_indicator_count = sum(1 for indicator in business_indicators if indicator in content_text)
        if business_indicator_count < 3:
            relevance_score -= 0.2
            warnings.append(f"Limited business information ({business_indicator_count}/12 indicators)")

        # Ensure score stays in valid range
        relevance_score = max(0.0, min(1.0, relevance_score))

        # Log relevance assessment
        if relevance_score < 0.7:
            logger.warning(f"Research relevance check for {company_name}: Score={relevance_score:.2f}, Warnings={len(warnings)}")
            for warning in warnings:
                logger.warning(f"  - {warning}")
        else:
            logger.info(f"Research relevance check for {company_name}: Score={relevance_score:.2f} (GOOD)")

        return relevance_score, warnings


def determine_lead_tier(
    validation_score: float,
    confidence_score: float,
    missing_data_points: int,
) -> Tuple[str, str]:
    """
    Determine lead tier based on research quality metrics.

    Lead Tier Classification:
    - A-Tier: Rich research data - validation_score >= 0.6 AND confidence >= 0.6 AND missing <= 1
    - B-Tier: Minimal research data - everything else (still usable, not penalized)

    B-tier leads will still get email generation but with adjusted QA thresholds
    and without penalization for missing research-specific personalization.

    Args:
        validation_score: Data completeness score (0-1) from validate_research_result
        confidence_score: Research confidence score (0-1) from ResearchResult
        missing_data_points: Number of missing data points out of 5

    Returns:
        Tuple of (tier: "A"/"B", reason: str explaining the classification)
    """
    # A-Tier: Rich research data available
    if (validation_score >= 0.6 and
        confidence_score >= 0.6 and
        missing_data_points <= 1):
        return "A", "Rich research data available"

    # B-Tier: Minimal research - build reason string
    reasons = []
    if validation_score < 0.6:
        reasons.append(f"validation={validation_score:.2f}")
    if confidence_score < 0.6:
        reasons.append(f"confidence={confidence_score:.2f}")
    if missing_data_points >= 2:
        reasons.append(f"missing {missing_data_points}/5 data points")

    reason_str = ", ".join(reasons) if reasons else "below A-tier thresholds"

    logger.info(f"Lead classified as B-tier: {reason_str}")
    return "B", f"Minimal research: {reason_str}"
