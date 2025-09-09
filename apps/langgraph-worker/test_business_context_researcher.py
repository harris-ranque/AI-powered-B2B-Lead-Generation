"""
Comprehensive test suite for Business Context Researcher
Tests various company types, confidence scoring, deep research, and error handling
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.langgraph.nodes.business_context_researcher import (
    BusinessContextResearcher, 
    business_context_researcher_node,
    BusinessContext
)
from app.langgraph.state import EmailGenerationState
from app.models.lead_models import Lead, BusinessProfile, EmailRequirements, ContactInfo


class TestBusinessContextResearcher:
    """Test class for BusinessContextResearcher functionality"""
    
    @pytest.fixture
    def researcher(self):
        """Create a BusinessContextResearcher instance for testing"""
        return BusinessContextResearcher()
    
    @pytest.fixture
    def sample_lead_startup(self):
        """Sample startup lead for testing"""
        return Lead(
            id="test-lead-1",
            company_name="TechStartup Inc",
            contact_name="John Doe",
            title="CTO",
            industry="Software",
            company_size="10-50",
            location="San Francisco, CA",
            description="AI-powered productivity tools for teams",
            website="https://techstartup.com",
            contact_info=ContactInfo(
                email="john@techstartup.com",
                website="https://techstartup.com"
            ),
            technologies=["React", "Node.js", "Python", "AWS"]
        )
    
    @pytest.fixture
    def sample_lead_enterprise(self):
        """Sample enterprise lead for testing"""
        return Lead(
            id="test-lead-2",
            company_name="Global Corp",
            contact_name="Sarah Smith",
            title="Director of IT",
            industry="Manufacturing",
            company_size="1000+",
            location="New York, NY",
            description="Fortune 500 manufacturing company",
            website="https://globalcorp.com",
            technologies=["SAP", "Oracle", "Microsoft"]
        )
    
    @pytest.fixture
    def sample_lead_local(self):
        """Sample local business lead for testing"""
        return Lead(
            id="test-lead-3",
            company_name="Local Restaurant",
            contact_name="Mike Johnson",
            title="Owner",
            industry="Food Service",
            company_size="1-10",
            location="Austin, TX",
            description="Family-owned restaurant serving authentic cuisine",
            website="https://localrestaurant.com"
        )
    
    @pytest.fixture
    def sample_business_profile(self):
        """Sample business profile for testing"""
        return BusinessProfile(
            company_name="Genni AI",
            industry="AI/Software",
            value_proposition="AI-powered lead generation and personalization",
            services=["Lead Generation", "Email Personalization", "CRM Integration"],
            target_markets=["B2B SaaS", "Marketing Agencies", "Sales Teams"],
            key_differentiators=["AI-powered", "Real-time", "Highly personalized"],
            contact_info={"email": "info@genni.ai", "website": "https://genni.ai"}
        )
    
    @pytest.fixture
    def sample_requirements(self):
        """Sample email requirements for testing"""
        return EmailRequirements(
            tone="professional",
            length="medium",
            call_to_action="Schedule a demo",
            personalization_level="high"
        )

    def test_clean_url(self, researcher):
        """Test URL cleaning and normalization"""
        # Test various URL formats
        assert researcher._clean_url("example.com") == "https://example.com"
        assert researcher._clean_url("http://example.com") == "http://example.com"
        assert researcher._clean_url("https://example.com") == "https://example.com"
        assert researcher._clean_url("https://example.com/path") == "https://example.com"
        assert researcher._clean_url("") == ""
        assert researcher._clean_url(None) == ""

    @pytest.mark.asyncio
    async def test_check_robots_txt_allowed(self, researcher):
        """Test robots.txt compliance checking - allowed case"""
        with patch.object(researcher, 'session') as mock_session:
            # Mock response for robots.txt that allows crawling
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.text = AsyncMock(return_value="User-agent: *\nAllow: /")
            mock_session.get.return_value.__aenter__.return_value = mock_response
            
            # Create mock session context
            researcher.session = mock_session
            
            result = await researcher._check_robots_txt("https://example.com")
            assert result is True

    @pytest.mark.asyncio
    async def test_check_robots_txt_not_found(self, researcher):
        """Test robots.txt compliance checking - no robots.txt file"""
        with patch.object(researcher, 'session') as mock_session:
            # Mock 404 response for robots.txt
            mock_response = AsyncMock()
            mock_response.status = 404
            mock_session.get.return_value.__aenter__.return_value = mock_response
            
            researcher.session = mock_session
            
            result = await researcher._check_robots_txt("https://example.com")
            assert result is True  # Default to allowed when no robots.txt

    @pytest.mark.asyncio
    async def test_scrape_website_success(self, researcher):
        """Test successful website scraping"""
        mock_html = """
        <html>
            <head>
                <title>Test Company - Leading Tech Solutions</title>
                <meta name="description" content="We provide cutting-edge technology solutions for businesses">
            </head>
            <body>
                <nav>Navigation</nav>
                <header>Header</header>
                <main>
                    <h1>Welcome to Test Company</h1>
                    <p>We are a leading provider of innovative technology solutions.</p>
                    <p>Our services include software development, cloud consulting, and digital transformation.</p>
                </main>
                <footer>Footer</footer>
                <script>Some JavaScript</script>
            </body>
        </html>
        """
        
        with patch.object(researcher, 'session') as mock_session:
            # Mock successful HTTP response
            mock_response = AsyncMock()
            mock_response.status = 200
            mock_response.text = AsyncMock(return_value=mock_html)
            mock_response.url = "https://example.com"
            mock_session.get.return_value.__aenter__.return_value = mock_response
            
            researcher.session = mock_session
            
            # Mock robots.txt check
            with patch.object(researcher, '_check_robots_txt', return_value=True):
                result = await researcher._scrape_website("https://example.com")
            
            assert result["title"] == "Test Company - Leading Tech Solutions"
            assert result["description"] == "We provide cutting-edge technology solutions for businesses"
            assert "innovative technology solutions" in result["content"]
            assert "Navigation" not in result["content"]  # Should be removed
            assert "Some JavaScript" not in result["content"]  # Should be removed

    @pytest.mark.asyncio
    async def test_scrape_website_robots_disallowed(self, researcher):
        """Test website scraping when robots.txt disallows"""
        with patch.object(researcher, 'session') as mock_session:
            researcher.session = mock_session
            
            # Mock robots.txt check that disallows
            with patch.object(researcher, '_check_robots_txt', return_value=False):
                result = await researcher._scrape_website("https://example.com")
            
            assert result["error"] == "Robots.txt disallows scraping"
            assert result["content"] == ""
            assert result["title"] == ""

    @pytest.mark.asyncio
    async def test_scrape_website_http_error(self, researcher):
        """Test website scraping with HTTP error"""
        with patch.object(researcher, 'session') as mock_session:
            # Mock HTTP error response
            mock_response = AsyncMock()
            mock_response.status = 404
            mock_session.get.return_value.__aenter__.return_value = mock_response
            
            researcher.session = mock_session
            
            with patch.object(researcher, '_check_robots_txt', return_value=True):
                result = await researcher._scrape_website("https://example.com")
            
            assert result["error"] == "HTTP 404"
            assert result["content"] == ""

    @pytest.mark.asyncio
    async def test_scrape_website_timeout(self, researcher):
        """Test website scraping with timeout"""
        with patch.object(researcher, 'session') as mock_session:
            # Mock timeout exception
            mock_session.get.side_effect = asyncio.TimeoutError()
            
            researcher.session = mock_session
            
            with patch.object(researcher, '_check_robots_txt', return_value=True):
                result = await researcher._scrape_website("https://example.com")
            
            assert result["error"] == "Timeout"

    def test_calculate_confidence_score_high_quality(self, researcher):
        """Test confidence scoring with high-quality data"""
        data = {
            "website_data": {
                "title": "Test Company - Leading Solutions",
                "description": "Comprehensive description of services",
                "content": "A" * 1000  # Long content
            },
            "company_search": {"data": "exists"},
            "data_sources": ["https://example.com", "https://example.com/about"]
        }
        
        score = researcher._calculate_confidence_score(data)
        assert score >= 0.8  # Should be high confidence

    def test_calculate_confidence_score_medium_quality(self, researcher):
        """Test confidence scoring with medium-quality data"""
        data = {
            "website_data": {
                "title": "Test Company",
                "content": "A" * 300  # Medium content
            },
            "data_sources": ["https://example.com"]
        }
        
        score = researcher._calculate_confidence_score(data)
        assert 0.4 <= score <= 0.7  # Should be medium confidence

    def test_calculate_confidence_score_low_quality(self, researcher):
        """Test confidence scoring with low-quality data"""
        data = {
            "website_data": {
                "error": "Timeout",
                "content": "A" * 50  # Very short content
            },
            "data_sources": []
        }
        
        score = researcher._calculate_confidence_score(data)
        assert score <= 0.3  # Should be low confidence

    @pytest.mark.asyncio
    async def test_perform_deep_research(self, researcher):
        """Test deep research functionality"""
        with patch.object(researcher, '_scrape_website') as mock_scrape:
            # Mock successful scraping of additional pages
            mock_scrape.side_effect = [
                {
                    "title": "About Us - Test Company",
                    "content": "We are a leading technology company founded in 2020.",
                    "url": "https://example.com/about"
                },
                {
                    "title": "Our Services - Test Company", 
                    "content": "We offer software development, consulting, and support services.",
                    "url": "https://example.com/services"
                },
                {"error": "Not found"}  # One page fails
            ]
            
            result = await researcher._perform_deep_research("Test Company", "https://example.com")
            
            assert result["deep_research"] is True
            assert len(result["additional_pages"]) == 2
            assert result["additional_pages"][0]["title"] == "About Us - Test Company"
            assert len(result["data_sources"]) == 2

    @pytest.mark.asyncio
    async def test_research_company_startup(self, researcher):
        """Test complete company research for startup"""
        with patch.object(researcher, '_scrape_website') as mock_scrape, \
             patch.object(researcher, '_search_company_info') as mock_search, \
             patch.object(researcher, '_perform_deep_research') as mock_deep:
            
            # Mock website scraping
            mock_scrape.return_value = {
                "title": "TechStartup - AI Productivity Tools",
                "description": "Revolutionary AI tools for team productivity",
                "content": "TechStartup is building the future of work with AI-powered productivity tools. Our platform helps teams collaborate more effectively and get more done.",
                "url": "https://techstartup.com"
            }
            
            # Mock company search
            mock_search.return_value = {"funding": "Series A", "employees": "25"}
            
            # Mock deep research (not triggered due to high confidence)
            mock_deep.return_value = {}
            
            result = await researcher.research_company(
                "TechStartup Inc", 
                "https://techstartup.com"
            )
            
            assert result["company_name"] == "TechStartup Inc"
            assert result["domain"] == "https://techstartup.com"
            assert result["confidence_score"] >= 0.7  # Should be high confidence
            assert "https://techstartup.com" in result["data_sources"]
            assert result["research_time"] > 0

    @pytest.mark.asyncio
    async def test_research_company_low_confidence_triggers_deep_research(self, researcher):
        """Test that low confidence triggers deep research"""
        with patch.object(researcher, '_scrape_website') as mock_scrape, \
             patch.object(researcher, '_search_company_info') as mock_search, \
             patch.object(researcher, '_perform_deep_research') as mock_deep:
            
            # Mock poor website scraping (low confidence)
            mock_scrape.return_value = {
                "error": "Timeout",
                "content": "",
                "title": ""
            }
            
            mock_search.return_value = {}
            
            # Mock deep research
            mock_deep.return_value = {
                "deep_research": True,
                "additional_pages": [{"url": "https://example.com/about", "content": "More content"}],
                "data_sources": ["https://example.com/about"]
            }
            
            result = await researcher.research_company(
                "Mystery Company", 
                "https://mystery.com"
            )
            
            # Verify deep research was called
            mock_deep.assert_called_once()
            assert result.get("deep_research") is True

    @pytest.mark.asyncio
    async def test_business_context_researcher_node_startup(self, sample_lead_startup, sample_business_profile, sample_requirements):
        """Test business context researcher node with startup lead"""
        state = {
            "request_id": "test-123",
            "lead": sample_lead_startup,
            "business_profile": sample_business_profile,
            "requirements": sample_requirements,
            "current_stage": "start",
            "agent_results": [],
            "processing_times": {},
            "confidence_scores": {},
            "quality_gates_passed": {},
            "errors": []
        }
        
        with patch('app.langgraph.nodes.business_context_researcher.BusinessContextResearcher') as mock_researcher_class:
            # Mock the researcher instance and its methods
            mock_researcher = AsyncMock()
            mock_researcher_class.return_value.__aenter__.return_value = mock_researcher
            
            mock_researcher.research_company.return_value = {
                "company_name": "TechStartup Inc",
                "domain": "https://techstartup.com",
                "confidence_score": 0.85,
                "research_time": 3.2,
                "website_data": {
                    "title": "TechStartup - AI Tools",
                    "description": "AI productivity tools",
                    "content": "We build AI-powered productivity tools for modern teams."
                },
                "data_sources": ["https://techstartup.com"]
            }
            
            # Mock the LLM analysis
            with patch('app.langgraph.nodes.business_context_researcher.ChatOpenAI') as mock_llm_class:
                mock_llm = AsyncMock()
                mock_analysis = BusinessContext(
                    company_overview="TechStartup Inc is an innovative AI company building productivity tools",
                    industry_focus="AI/Software Technology",
                    business_model="SaaS subscription model",
                    key_services=["AI Productivity Tools", "Team Collaboration Software"],
                    target_customers="Small to medium businesses and teams",
                    pain_points=["Team productivity challenges", "Remote work coordination"],
                    technology_stack=["React", "Node.js", "Python", "AWS"],
                    competitive_landscape="Competing with Slack, Monday.com, and Asana",
                    growth_stage="Early growth stage startup",
                    recent_news=["Series A funding announcement"],
                    confidence_score=0.85,
                    data_sources=["https://techstartup.com", "Company website analysis"]
                )
                mock_llm.ainvoke.return_value = mock_analysis
                mock_llm_class.return_value.with_structured_output.return_value = mock_llm
                
                result = await business_context_researcher_node(state)
                
                assert result["current_stage"] == "business_context_research"
                assert result["business_context"]["confidence_score"] == 0.85
                assert "AI Productivity Tools" in result["business_context"]["key_services"]
                assert len(result["agent_results"]) == 1
                assert result["agent_results"][0].agent_name == "Business Context Researcher"

    @pytest.mark.asyncio
    async def test_business_context_researcher_node_enterprise(self, sample_lead_enterprise, sample_business_profile, sample_requirements):
        """Test business context researcher node with enterprise lead"""
        state = {
            "request_id": "test-456",
            "lead": sample_lead_enterprise,
            "business_profile": sample_business_profile,
            "requirements": sample_requirements,
            "current_stage": "start",
            "agent_results": [],
            "processing_times": {},
            "confidence_scores": {},
            "quality_gates_passed": {},
            "errors": []
        }
        
        with patch('app.langgraph.nodes.business_context_researcher.BusinessContextResearcher') as mock_researcher_class:
            mock_researcher = AsyncMock()
            mock_researcher_class.return_value.__aenter__.return_value = mock_researcher
            
            mock_researcher.research_company.return_value = {
                "company_name": "Global Corp",
                "domain": "https://globalcorp.com",
                "confidence_score": 0.92,
                "research_time": 2.8,
                "website_data": {
                    "title": "Global Corp - Manufacturing Excellence",
                    "description": "Fortune 500 manufacturing leader",
                    "content": "Global Corp is a Fortune 500 manufacturing company with operations worldwide."
                },
                "data_sources": ["https://globalcorp.com", "https://globalcorp.com/about"]
            }
            
            with patch('app.langgraph.nodes.business_context_researcher.ChatOpenAI') as mock_llm_class:
                mock_llm = AsyncMock()
                mock_analysis = BusinessContext(
                    company_overview="Global Corp is a Fortune 500 manufacturing company",
                    industry_focus="Manufacturing and Industrial Operations",
                    business_model="Manufacturing and distribution",
                    key_services=["Manufacturing", "Industrial Solutions", "Supply Chain"],
                    target_customers="Enterprise and government clients",
                    pain_points=["Supply chain optimization", "Digital transformation"],
                    technology_stack=["SAP", "Oracle", "Microsoft"],
                    competitive_landscape="Major manufacturing competitor",
                    growth_stage="Mature enterprise",
                    recent_news=["Digital transformation initiative"],
                    confidence_score=0.92,
                    data_sources=["https://globalcorp.com", "Corporate website analysis"]
                )
                mock_llm.ainvoke.return_value = mock_analysis
                mock_llm_class.return_value.with_structured_output.return_value = mock_llm
                
                result = await business_context_researcher_node(state)
                
                assert result["current_stage"] == "business_context_research"
                assert result["business_context"]["confidence_score"] == 0.92
                assert "Fortune 500" in result["business_context"]["company_overview"]
                assert result["quality_gates_passed"]["business_context_research"] is True

    @pytest.mark.asyncio
    async def test_business_context_researcher_node_error_handling(self, sample_lead_startup, sample_business_profile, sample_requirements):
        """Test error handling in business context researcher node"""
        state = {
            "request_id": "test-error",
            "lead": sample_lead_startup,
            "business_profile": sample_business_profile,
            "requirements": sample_requirements,
            "current_stage": "start",
            "agent_results": [],
            "errors": []
        }
        
        with patch('app.langgraph.nodes.business_context_researcher.BusinessContextResearcher') as mock_researcher_class:
            # Simulate an exception during research
            mock_researcher_class.return_value.__aenter__.side_effect = Exception("Network error")
            
            result = await business_context_researcher_node(state)
            
            assert result["current_stage"] == "error"
            assert "Network error" in result["business_context"]["error"]
            assert result["business_context"]["confidence_score"] == 0.1
            assert len(result["errors"]) == 1
            assert "Business context researcher error" in result["errors"][0]

    @pytest.mark.asyncio
    async def test_confidence_scoring_logic(self, researcher):
        """Test various confidence scoring scenarios"""
        # High confidence scenario
        high_quality_data = {
            "website_data": {
                "title": "Company Name - Description",
                "description": "Detailed company description",
                "content": "A" * 1000,  # Long content
            },
            "company_search": {"info": "exists"},
            "data_sources": ["website", "about", "services"]
        }
        
        high_score = researcher._calculate_confidence_score(high_quality_data)
        assert high_score >= 0.8
        
        # Medium confidence scenario
        medium_quality_data = {
            "website_data": {
                "title": "Company",
                "content": "A" * 300,  # Medium content
            },
            "data_sources": ["website"]
        }
        
        medium_score = researcher._calculate_confidence_score(medium_quality_data)
        assert 0.3 <= medium_score <= 0.7
        
        # Low confidence scenario
        low_quality_data = {
            "website_data": {
                "error": "Failed to scrape",
                "content": "",
            },
            "data_sources": []
        }
        
        low_score = researcher._calculate_confidence_score(low_quality_data)
        assert low_score <= 0.3

    @pytest.mark.asyncio
    async def test_deep_research_trigger(self, researcher):
        """Test that deep research is triggered correctly"""
        # Test with low confidence (should trigger deep research)
        with patch.object(researcher, '_scrape_website') as mock_scrape, \
             patch.object(researcher, '_search_company_info') as mock_search, \
             patch.object(researcher, '_perform_deep_research') as mock_deep:
            
            # Mock low-quality initial data
            mock_scrape.return_value = {"error": "timeout", "content": "", "title": ""}
            mock_search.return_value = {}
            mock_deep.return_value = {"deep_research": True, "additional_pages": []}
            
            result = await researcher.research_company("Test Co", "https://test.com")
            
            # Verify deep research was called
            mock_deep.assert_called_once_with("Test Co", "https://test.com")
        
        # Test with high confidence (should not trigger deep research)
        with patch.object(researcher, '_scrape_website') as mock_scrape, \
             patch.object(researcher, '_search_company_info') as mock_search, \
             patch.object(researcher, '_perform_deep_research') as mock_deep:
            
            # Mock high-quality initial data
            mock_scrape.return_value = {
                "title": "Test Company",
                "description": "Great company",
                "content": "A" * 1000,
                "url": "https://test.com"
            }
            mock_search.return_value = {"data": "exists"}
            
            result = await researcher.research_company("Test Co", "https://test.com")
            
            # Verify deep research was NOT called (high confidence)
            mock_deep.assert_not_called()

    def test_performance_requirements(self):
        """Test that the research meets performance requirements"""
        # The implementation should complete within 30 seconds for initial research
        # and 45 seconds total with deep research. This is tested in integration tests.
        
        # Test timeout settings
        researcher = BusinessContextResearcher()
        assert researcher.timeout.total == 10  # 10 second timeout per request
        assert researcher.max_retries == 2
        
        # Test user agent
        assert "Genni Business Research Bot" in researcher.user_agent


if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v"])