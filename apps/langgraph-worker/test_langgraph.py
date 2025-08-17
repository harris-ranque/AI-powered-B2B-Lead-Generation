#!/usr/bin/env python3
"""
Simple test script to validate LangGraph email generation workflow
"""
import asyncio
import os
import sys
from datetime import datetime

# Add the app directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from app.models.lead_models import Lead, BusinessProfile, EmailRequirements
from app.langgraph.workflow import execute_email_generation

async def test_email_generation():
    """Test the complete email generation workflow"""
    print("🧪 Testing LangGraph Email Generation Workflow")
    print("=" * 50)
    
    # Create test data
    lead = Lead(
        id="test-lead-001",
        company_name="TechCorp Solutions",
        contact_name="Sarah Johnson",
        title="Chief Technology Officer",
        industry="Software Development",
        company_size="50-100 employees",
        location="San Francisco, CA",
        description="A mid-size software company specializing in enterprise SaaS solutions",
        website="https://techcorp.example.com"
    )
    
    business_profile = BusinessProfile(
        company_name="Genni",
        industry="Business Services",
        value_proposition="AI-powered lead generation and personalization that increases conversion rates by 60%",
        services=["Lead Generation", "Email Personalization", "Sales Automation", "CRM Integration"],
        target_markets=["B2B SaaS", "Professional Services", "E-commerce"],
        key_differentiators=["AI-powered personalization", "Multi-agent analysis", "Real-time insights"],
        contact_info={"email": "contact@genni.com", "phone": "+1-555-0123"}
    )
    
    requirements = EmailRequirements(
        tone="professional",
        length="medium",
        call_to_action="Schedule a 15-minute demo call",
        include_case_study=True,
        personalization_level="high",
        follow_up_sequence=True
    )
    
    request_id = f"test-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    
    print(f"🚀 Starting workflow for {lead.company_name}")
    print(f"📧 Contact: {lead.contact_name} ({lead.title})")
    print(f"🏢 Industry: {lead.industry}")
    print(f"📍 Location: {lead.location}")
    print()
    
    try:
        # Execute the workflow
        result = await execute_email_generation(
            lead=lead,
            business_profile=business_profile,
            requirements=requirements,
            request_id=request_id
        )
        
        if result["status"] == "completed":
            email_result = result["result"]
            
            print("✅ Email Generation Completed Successfully!")
            print("=" * 50)
            print(f"📊 Relevance Score: {email_result.relevance_score:.2f}")
            print(f"⏱️  Processing Time: {email_result.processing_time:.2f}s")
            print(f"🎯 Agents Executed: {len(email_result.agent_results)}")
            print()
            
            print("🧠 Agent Results:")
            for agent in email_result.agent_results:
                print(f"  • {agent.agent_name}: {agent.confidence_score:.2f} confidence")
                print(f"    {agent.output}")
            print()
            
            print("💡 Pain Points Identified:")
            for i, pain_point in enumerate(email_result.pain_points_identified[:3], 1):
                print(f"  {i}. {pain_point}")
            print()
            
            print("🎯 Value Matches:")
            for i, value_match in enumerate(email_result.value_matches[:3], 1):
                print(f"  {i}. {value_match}")
            print()
            
            if email_result.primary_email:
                print("📧 Generated Email:")
                print(f"Subject: {email_result.primary_email.subject}")
                print("Body:")
                print(email_result.primary_email.body)
                print()
                print(f"Estimated Effectiveness: {email_result.primary_email.estimated_effectiveness:.0%}")
                print()
            
            if email_result.follow_up_sequence:
                print(f"📅 Follow-up Sequence: {len(email_result.follow_up_sequence.emails)} emails planned")
                print(f"Strategy: {email_result.follow_up_sequence.conversion_strategy}")
                print()
            
            print("💡 Recommendations:")
            for rec in email_result.recommendations:
                print(f"  • {rec}")
            
            return True
            
        else:
            print("❌ Email Generation Failed!")
            print(f"Error: {result.get('error', 'Unknown error')}")
            if 'errors' in result:
                for error in result['errors']:
                    print(f"  • {error}")
            return False
            
    except Exception as e:
        print(f"❌ Test Failed with Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    # Check if OpenAI API key is set
    if not os.getenv("OPENAI_API_KEY"):
        print("⚠️  Warning: OPENAI_API_KEY environment variable not set")
        print("Set it with: export OPENAI_API_KEY='your-api-key-here'")
        sys.exit(1)
    
    # Run the test
    success = asyncio.run(test_email_generation())
    
    if success:
        print("\n🎉 All tests passed! LangGraph workflow is working correctly.")
        sys.exit(0)
    else:
        print("\n💥 Tests failed! Check the errors above.")
        sys.exit(1)