#!/usr/bin/env python3
"""
Workflow Demo - Test LangGraph workflow without external API calls
"""
import asyncio
import json
from datetime import datetime
from app.langgraph.workflow import create_email_generation_workflow
from app.langgraph.state import EmailGenerationState
from app.models.lead_models import Lead, BusinessProfile, EmailRequirements

async def demo_workflow_visualization():
    """
    Demo the workflow for visualization in LangGraph Studio
    Creates a workflow instance and shows the graph structure
    """
    print("🚀 Creating LangGraph Workflow for Visualization")
    print("=" * 60)
    
    # Create the workflow
    workflow = create_email_generation_workflow()
    
    print("✅ Workflow created successfully!")
    print(f"📊 Workflow type: {type(workflow)}")
    
    # Print workflow structure
    print("\n📋 Workflow Structure:")
    if hasattr(workflow, 'graph'):
        graph = workflow.graph
        print(f"   Nodes: {list(graph.nodes.keys())}")
        print(f"   Edges: {len(graph.edges)} connections")
        
        # Show node details
        print("\n🔗 Node Connections:")
        for node_name in graph.nodes.keys():
            node = graph.nodes[node_name]
            print(f"   • {node_name}: {type(node).__name__}")
    
    # Create sample state for testing
    sample_state = {
        "request_id": "demo-visualization-001",
        "lead": Lead(
            id="demo-lead",
            company_name="Demo Tech Corp",
            contact_name="Demo User",
            email="demo@techcorp.com",
            industry="Technology",
            description="Demo company for workflow testing"
        ),
        "business_profile": BusinessProfile(
            company_name="Genni AI",
            industry="AI/Technology", 
            value_proposition="AI-powered lead generation",
            services=["Lead Generation", "Email Automation"],
            target_markets=["B2B SaaS"],
            key_differentiators=["Multi-agent AI"],
            contact_info={"email": "contact@genni.ai"}
        ),
        "requirements": EmailRequirements(
            call_to_action="Schedule a demo"
        ),
        "current_stage": "start",
        "start_time": datetime.now().isoformat(),
        "agent_results": [],
        "errors": [],
        "processing_times": {},
        "confidence_scores": {},
        "quality_gates_passed": {},
        "recommendations": [],
        "intermediate_results": {}
    }
    
    print("\n📝 Sample State Created:")
    print(f"   Request ID: {sample_state['request_id']}")
    print(f"   Lead: {sample_state['lead'].company_name}")
    print(f"   Stage: {sample_state['current_stage']}")
    
    return workflow, sample_state

def save_workflow_config():
    """Save workflow configuration for LangGraph Studio"""
    config = {
        "dependencies": ["."],
        "graphs": {
            "email_generation": "app.langgraph.workflow:create_email_generation_workflow"
        },
        "env": ".env"
    }
    
    with open("langgraph.json", "w") as f:
        json.dump(config, f, indent=2)
    
    print("💾 LangGraph configuration saved to langgraph.json")

async def main():
    """Main demo function"""
    print("🎯 LangGraph Workflow Demo & Visualization Setup")
    print("=" * 80)
    
    try:
        # Create workflow
        workflow, sample_state = await demo_workflow_visualization()
        
        # Save configuration
        save_workflow_config()
        
        print("\n✅ Demo Setup Complete!")
        print("\n🎨 Next Steps for Visualization:")
        print("1. Install LangGraph CLI: pip install langgraph-cli")
        print("2. Launch Studio: python launch_langgraph_studio.py")
        print("3. Open browser: http://localhost:3001")
        print("4. Select 'email_generation' workflow")
        print("5. Use sample state for testing")
        
        print("\n📊 Sample State for Testing:")
        sample_data = {
            "request_id": sample_state["request_id"],
            "lead": sample_state["lead"].model_dump(),
            "business_profile": sample_state["business_profile"].model_dump(),
            "requirements": sample_state["requirements"].model_dump(),
            "current_stage": sample_state["current_stage"],
            "start_time": sample_state["start_time"]
        }
        print(json.dumps(sample_data, indent=2, default=str))
        
    except Exception as e:
        print(f"❌ Demo error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())