#!/usr/bin/env python3
"""
Test script to verify LangGraph worker integration with Convex backend
"""
import os
import asyncio
import aiohttp
import json
from datetime import datetime
from app.utils.config import get_settings

async def test_health_endpoint():
    """Test the health endpoint"""
    print("🔍 Testing health endpoint...")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get("http://localhost:8080/health") as response:
                if response.status == 200:
                    data = await response.json()
                    print(f"✅ Health check passed: {data['status']}")
                    return True
                else:
                    print(f"❌ Health check failed: {response.status}")
                    return False
    except Exception as e:
        print(f"❌ Health check error: {e}")
        return False

async def test_webhook_configuration():
    """Test webhook configuration"""
    print("\n🔍 Testing webhook configuration...")
    
    settings = get_settings()
    
    print(f"📡 Webhook URL: {settings.webhook_url}")
    print(f"🔐 API Key configured: {'Yes' if settings.api_key else 'No'}")
    print(f"🌐 Convex URL: {settings.convex_url}")
    
    if settings.webhook_url and settings.api_key:
        print("✅ Webhook configuration looks good")
        return True
    else:
        print("❌ Webhook configuration incomplete")
        return False

async def test_agents_info():
    """Test the agents info endpoint"""
    print("\n🔍 Testing agents info endpoint...")
    
    settings = get_settings()
    
    try:
        headers = {}
        if settings.api_key:
            headers["Authorization"] = f"Bearer {settings.api_key}"
        
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "http://localhost:8080/agents/info",
                headers=headers
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    print(f"✅ Agents info retrieved: {len(data.get('agents', []))} agents")
                    print(f"   Workflow engine: {data.get('workflow_engine', 'Unknown')}")
                    return True
                else:
                    print(f"❌ Agents info failed: {response.status}")
                    return False
    except Exception as e:
        print(f"❌ Agents info error: {e}")
        return False

async def test_webhook_connectivity():
    """Test webhook connectivity to Convex"""
    print("\n🔍 Testing webhook connectivity to Convex...")
    
    settings = get_settings()
    
    if not settings.webhook_url:
        print("❌ No webhook URL configured")
        return False
    
    try:
        headers = {"Content-Type": "application/json"}
        if settings.api_key:
            headers["Authorization"] = f"Bearer {settings.api_key}"
        
        # Test payload
        payload = {
            "request_id": "test_integration_" + datetime.now().strftime("%Y%m%d_%H%M%S"),
            "status": "completed",
            "timestamp": datetime.utcnow().isoformat(),
            "result": {
                "test": True,
                "message": "Integration test webhook"
            }
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                settings.webhook_url,
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status == 200:
                    print("✅ Webhook connectivity test passed")
                    return True
                else:
                    print(f"❌ Webhook test failed: {response.status}")
                    text = await response.text()
                    print(f"   Response: {text[:200]}...")
                    return False
    except asyncio.TimeoutError:
        print("❌ Webhook test timed out")
        return False
    except Exception as e:
        print(f"❌ Webhook test error: {e}")
        return False

async def main():
    """Run all integration tests"""
    print("🚀 Starting LangGraph-Convex integration tests...")
    print("=" * 60)
    
    tests = [
        ("Health Endpoint", test_health_endpoint),
        ("Webhook Configuration", test_webhook_configuration),
        ("Agents Info", test_agents_info),
        ("Webhook Connectivity", test_webhook_connectivity),
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            result = await test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"❌ {test_name} crashed: {e}")
            results.append((test_name, False))
    
    print("\n" + "=" * 60)
    print("📊 Integration Test Results:")
    print("=" * 60)
    
    passed = 0
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} {test_name}")
        if result:
            passed += 1
    
    print(f"\n📈 Summary: {passed}/{len(results)} tests passed")
    
    if passed == len(results):
        print("🎉 All integration tests passed! LangGraph worker is properly configured.")
        return True
    else:
        print("⚠️  Some tests failed. Please check the configuration.")
        return False

if __name__ == "__main__":
    asyncio.run(main())