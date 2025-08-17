#!/usr/bin/env python3
"""
LangGraph Studio Launcher
Launches LangGraph Studio with proper configuration for visualization
"""
import subprocess
import sys
import os
import time
import requests
from pathlib import Path

def check_dependencies():
    """Check if required dependencies are installed"""
    print("🔍 Checking dependencies...")
    
    try:
        import langgraph
        print(f"✅ LangGraph installed: {langgraph.__version__}")
    except ImportError:
        print("❌ LangGraph not found. Installing...")
        subprocess.run([sys.executable, "-m", "pip", "install", "langgraph>=0.2.0"])
    
    # Check if langgraph command is available
    try:
        result = subprocess.run(["langgraph", "--help"], capture_output=True, text=True)
        if result.returncode == 0:
            print("✅ LangGraph CLI available")
            return True
    except FileNotFoundError:
        pass
    
    print("❌ LangGraph CLI not found. Installing...")
    subprocess.run([sys.executable, "-m", "pip", "install", "langgraph-cli"])
    return True

def ensure_config_exists():
    """Ensure LangGraph configuration file exists"""
    config_file = Path("langgraph.json")
    
    if not config_file.exists():
        print("📝 Creating LangGraph configuration...")
        config = {
            "dependencies": ["."],
            "graphs": {
                "email_generation": "app.langgraph.workflow:create_email_generation_workflow"
            },
            "env": ".env"
        }
        
        with open(config_file, 'w') as f:
            import json
            json.dump(config, f, indent=2)
        
        print("✅ Configuration created")
    else:
        print("✅ Configuration exists")

def launch_studio():
    """Launch LangGraph Studio"""
    print("🚀 Launching LangGraph Studio...")
    print("📍 Studio will be available at: http://localhost:3001")
    print("⏹️ Press Ctrl+C to stop")
    
    try:
        # Launch LangGraph Studio
        subprocess.run([
            "langgraph", "studio", 
            "--port", "3001",
            "--host", "localhost"
        ])
    except KeyboardInterrupt:
        print("\n🛑 LangGraph Studio stopped")
    except Exception as e:
        print(f"❌ Error launching studio: {e}")
        return False
    
    return True

def show_instructions():
    """Show usage instructions"""
    print("\n" + "="*80)
    print("🎯 LANGGRAPH STUDIO INSTRUCTIONS")
    print("="*80)
    print()
    print("1. 🌐 Access the Studio:")
    print("   → Open your browser to: http://localhost:3001")
    print()
    print("2. 📊 Visualize Workflows:")
    print("   → Select 'email_generation' workflow from the dropdown")
    print("   → View the graph visualization with all nodes and edges")
    print()
    print("3. 🧪 Test with Sample Data:")
    print("   → Click 'Input' to provide test data")
    print("   → Use the comprehensive test suite: python test_integration_comprehensive.py")
    print()
    print("4. 🔍 Debug Execution:")
    print("   → Run workflows step-by-step")
    print("   → Inspect state at each node")
    print("   → View agent outputs and confidence scores")
    print()
    print("5. 📈 Monitor Performance:")
    print("   → Track execution times per node")
    print("   → Analyze workflow efficiency")
    print("   → Identify bottlenecks")
    print()
    print("6. 🔧 Development Features:")
    print("   → Edit workflow logic in real-time")
    print("   → Test different routing scenarios")
    print("   → Validate state transitions")
    print()
    print("="*80)

def main():
    """Main entry point"""
    print("🚀 LangGraph Studio Launcher")
    print("="*50)
    
    # Change to the correct directory
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    print(f"📂 Working directory: {script_dir}")
    
    # Check dependencies
    if not check_dependencies():
        print("❌ Dependency check failed")
        return False
    
    # Ensure configuration exists
    ensure_config_exists()
    
    # Show instructions
    show_instructions()
    
    # Ask user if they want to continue
    response = input("\n🚀 Launch LangGraph Studio now? [Y/n]: ").strip().lower()
    if response in ['', 'y', 'yes']:
        return launch_studio()
    else:
        print("👋 Studio launch cancelled. Run this script again when ready!")
        return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)