"""
Email Writer Node for LangGraph workflow
Crafts personalized, compelling email content
"""
import time
from typing import Dict, Any, List
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from ...utils.config import get_settings
from ...utils.logger import setup_logger
from ...models.lead_models import AgentResult, EmailContent
from ..state import EmailGenerationState

logger = setup_logger(__name__)
settings = get_settings()

class EmailStructure(BaseModel):
    """Structured output for email generation"""
    subject_line: str = Field(..., description="Compelling, specific subject line")
    opening_line: str = Field(..., description="Personalized opening that shows research")
    pain_point_acknowledgment: str = Field(..., description="Acknowledge their specific challenges")
    value_proposition: str = Field(..., description="How we solve their problems")
    proof_points: List[str] = Field(..., description="Evidence, metrics, or case studies")
    call_to_action: str = Field(..., description="Clear next step")
    closing: str = Field(..., description="Professional closing")
    ps_line: str = Field(default="", description="Optional P.S. for additional engagement")
    personalization_elements: List[str] = Field(..., description="Specific personalization used")

async def email_writer_node(state: EmailGenerationState) -> Dict[str, Any]:
    """
    Create personalized email content based on all previous analysis.
    
    This node generates:
    - Compelling subject line
    - Personalized opening
    - Value-driven body
    - Clear call to action
    - Professional closing
    
    Args:
        state: Current workflow state
        
    Returns:
        Updated state with generated email
    """
    start_time = time.time()
    logger.info(f"Starting email generation for {state['lead'].company_name}")
    
    try:
        # Initialize LLM with structured output
        llm = ChatOpenAI(
            model=settings.default_model,
            temperature=settings.temperature,
            max_tokens=settings.max_tokens,
            openai_api_key=settings.openai_api_key
        ).with_structured_output(EmailStructure)
        
        # Get context from previous nodes
        lead = state["lead"]
        requirements = state["requirements"]
        pain_points = state.get("pain_points", [])
        value_matches = state.get("value_matches", [])
        relevance_context = state.get("relevance_analysis", {})
        value_alignment = state.get("intermediate_results", {}).get("value_alignment", {})
        
        # Create email writing prompt
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert copywriter and email marketing specialist with 
            extensive experience in B2B communication. You know how to craft messages that 
            cut through noise, build rapport, and drive action. Your emails consistently 
            achieve high open rates and response rates because they feel personal and valuable.
            
            Email best practices:
            - Keep subject lines under 50 characters
            - Personalize based on specific research
            - Lead with value, not features
            - Use conversational, professional tone
            - Make the CTA easy and low-pressure
            - Keep body between 150-250 words
            - Show you understand their specific situation
            """),
            ("human", """Write a personalized business email based on this analysis:
            
            Lead Information:
            - Company: {company_name}
            - Contact: {contact_name} ({title})
            - Industry: {industry}
            - Company Size: {company_size}
            
            Key Pain Points Identified:
            {pain_points}
            
            Our Value Propositions:
            {value_matches}
            
            Additional Context:
            - Qualification Level: {qualification_level}
            - Key Opportunities: {opportunities}
            - Quantified Benefits: {quantified_benefits}
            
            Email Requirements:
            - Tone: {tone}
            - Length: {length}
            - Call to Action: {cta}
            - Include Case Study: {include_case_study}
            - Personalization Level: {personalization_level}
            
            Create an email that:
            1. Has an attention-grabbing, specific subject line
            2. Opens with genuine understanding of their situation
            3. Acknowledges their pain points naturally
            4. Presents our value clearly and compellingly
            5. Includes relevant proof or metrics
            6. Has a clear, low-pressure call to action
            7. Feels personal, not templated
            
            Make every element specific to their situation.
            """)
        ])
        
        # Execute email generation
        business_profile = state["business_profile"]
        
        email_structure: EmailStructure = await llm.ainvoke(prompt.format_messages(
            company_name=lead.company_name,
            contact_name=lead.contact_name or "there",
            title=lead.title or "professional",
            industry=lead.industry or "your industry",
            company_size=lead.company_size or "your size company",
            pain_points="\n".join(f"- {pp}" for pp in pain_points[:3]),
            value_matches="\n".join(f"- {vm}" for vm in value_matches[:3]),
            qualification_level=relevance_context.get("qualification_level", "qualified"),
            opportunities=", ".join(relevance_context.get("opportunities", [])[:2]),
            quantified_benefits=", ".join(value_alignment.get("quantified_benefits", [])[:2]),
            tone=requirements.tone,
            length=requirements.length,
            cta=requirements.call_to_action,
            include_case_study=requirements.include_case_study,
            personalization_level=requirements.personalization_level
        ))
        
        # Construct full email body
        email_body_parts = [
            f"Hi {lead.contact_name or 'there'},",
            "",
            email_structure.opening_line,
            "",
            email_structure.pain_point_acknowledgment,
            "",
            email_structure.value_proposition,
            ""
        ]
        
        # Add proof points if available
        if email_structure.proof_points:
            for proof in email_structure.proof_points[:2]:
                email_body_parts.append(f"• {proof}")
            email_body_parts.append("")
        
        # Add CTA and closing
        email_body_parts.extend([
            email_structure.call_to_action,
            "",
            email_structure.closing,
            "",
            "Best regards,",
            "[Your name]"
        ])
        
        # Add P.S. if provided
        if email_structure.ps_line:
            email_body_parts.extend(["", f"P.S. {email_structure.ps_line}"])
        
        email_body = "\n".join(email_body_parts)
        
        execution_time = time.time() - start_time
        
        # Create EmailContent object
        primary_email = EmailContent(
            subject=email_structure.subject_line,
            body=email_body,
            personalization_notes=email_structure.personalization_elements,
            estimated_effectiveness=0.78  # Could be calculated based on various factors
        )
        
        # Create agent result
        agent_result = AgentResult(
            agent_name="Email Writer",
            role="Content creation and personalization",
            output=f"Generated personalized email with subject: '{email_structure.subject_line[:50]}...'",
            confidence_score=0.92,
            execution_time=execution_time
        )
        
        # Update state
        logger.info(f"Email generation complete: '{email_structure.subject_line}'")
        
        return {
            "primary_email": primary_email,
            "current_stage": "email_writing",
            "agent_results": [*state.get("agent_results", []), agent_result],
            "processing_times": {
                **state.get("processing_times", {}),
                "email_writer": execution_time
            },
            "confidence_scores": {
                **state.get("confidence_scores", {}),
                "email_writer": agent_result.confidence_score
            },
            "quality_gates_passed": {
                **state.get("quality_gates_passed", {}),
                "email_generation": True
            }
        }
        
    except Exception as e:
        logger.error(f"Error in email writer: {str(e)}")
        execution_time = time.time() - start_time
        
        # Fallback to basic email
        lead = state["lead"]
        business_profile = state["business_profile"]
        
        fallback_email = EmailContent(
            subject=f"Strategic Solutions for {lead.company_name}",
            body=f"""Hi {lead.contact_name or 'there'},

I noticed {lead.company_name} is in the {lead.industry or 'business'} sector and appears to be at an exciting growth stage.

Our {business_profile.value_proposition} has helped similar businesses achieve significant improvements in efficiency and growth.

Would you be open to a brief conversation about how we might be able to help {lead.company_name}?

Best regards,
[Your name]""",
            personalization_notes=["Company name", "Industry reference"],
            estimated_effectiveness=0.5
        )
        
        agent_result = AgentResult(
            agent_name="Email Writer",
            role="Content creation and personalization",
            output=f"Error during generation, using fallback: {str(e)}",
            confidence_score=0.4,
            execution_time=execution_time
        )
        
        return {
            "primary_email": fallback_email,
            "current_stage": "email_writing",
            "agent_results": [*state.get("agent_results", []), agent_result],
            "errors": [*state.get("errors", []), f"Email writer error: {str(e)}"],
            "processing_times": {
                **state.get("processing_times", {}),
                "email_writer": execution_time
            }
        }