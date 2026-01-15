import { describe, it, expect } from "vitest";
import {
  sanitizeString,
  sanitizeRichText,
  sanitizeStringArray,
  validateEmailStrict,
  validateUrlStrict,
  normalizeUrlStrict,
  sanitizeContactInfo,
  sanitizeSingleLine,
  containsXssPatterns,
  RICH_TEXT_ALLOWED_TAGS,
} from "../../convex/lib/sanitization";

describe("sanitization", () => {
  describe("sanitizeString", () => {
    describe("basic sanitization", () => {
      it("should return empty string for null input", () => {
        expect(sanitizeString(null)).toBe("");
      });

      it("should return empty string for undefined input", () => {
        expect(sanitizeString(undefined)).toBe("");
      });

      it("should return empty string for non-string input", () => {
        expect(sanitizeString(123 as any)).toBe("");
        expect(sanitizeString({} as any)).toBe("");
      });

      it("should pass through plain text", () => {
        expect(sanitizeString("Hello World")).toBe("Hello World");
      });

      it("should trim whitespace by default", () => {
        expect(sanitizeString("  Hello World  ")).toBe("Hello World");
      });

      it("should not trim when disabled", () => {
        expect(sanitizeString("  Hello  ", { trim: false })).toBe("  Hello  ");
      });
    });

    describe("XSS protection", () => {
      it("should remove script tags", () => {
        expect(sanitizeString("<script>alert(1)</script>")).toBe("");
      });

      it("should handle nested script tags", () => {
        // DOMPurify safely handles malformed nested tags - the result may
        // contain HTML-encoded entities but no executable code
        const result = sanitizeString("<<script>script>alert(1)<</script>/script>");
        expect(result).not.toContain("<script");
        expect(result).not.toContain("alert(");
      });

      it("should remove event handlers", () => {
        expect(sanitizeString('<img onerror="alert(1)">')).toBe("");
      });

      it("should remove onclick handlers", () => {
        expect(sanitizeString('<div onclick="alert(1)">Click</div>')).toBe(
          "Click"
        );
      });

      it("should remove javascript: protocol in links", () => {
        const result = sanitizeString(
          '<a href="javascript:alert(1)">Click</a>'
        );
        expect(result).toBe("Click");
        expect(result).not.toContain("javascript:");
      });

      it("should remove data: protocol", () => {
        const result = sanitizeString(
          '<img src="data:text/html,<script>alert(1)</script>">'
        );
        expect(result).not.toContain("data:");
        expect(result).not.toContain("script");
      });

      it("should handle unicode obfuscation", () => {
        // \u003c = <, \u003e = >
        expect(
          sanitizeString("\u003cscript\u003ealert(1)\u003c/script\u003e")
        ).toBe("");
      });

      it("should remove iframe tags", () => {
        expect(sanitizeString('<iframe src="evil.com"></iframe>')).toBe("");
      });

      it("should remove svg with onload", () => {
        expect(
          sanitizeString('<svg onload="alert(1)"><circle></circle></svg>')
        ).toBe("");
      });

      it("should handle mixed malicious and valid content", () => {
        expect(
          sanitizeString('Hello <script>alert(1)</script> World')
        ).toBe("Hello  World");
      });

      it("should remove style tags", () => {
        expect(
          sanitizeString("<style>body { display: none; }</style>Text")
        ).toBe("Text");
      });
    });

    describe("length limits", () => {
      it("should enforce default max length of 1000", () => {
        const longString = "a".repeat(1500);
        expect(sanitizeString(longString)).toHaveLength(1000);
      });

      it("should enforce custom max length", () => {
        const longString = "a".repeat(100);
        expect(sanitizeString(longString, { maxLength: 50 })).toHaveLength(50);
      });

      it("should not truncate short strings", () => {
        expect(sanitizeString("Hello", { maxLength: 100 })).toBe("Hello");
      });
    });

    describe("allowed tags", () => {
      it("should strip all HTML by default", () => {
        expect(sanitizeString("<b>Bold</b> text")).toBe("Bold text");
      });

      it("should allow specified tags when stripAllHtml is false", () => {
        const result = sanitizeString("<b>Bold</b> and <i>italic</i>", {
          stripAllHtml: false,
          allowedTags: ["b"],
        });
        expect(result).toContain("<b>Bold</b>");
        expect(result).not.toContain("<i>");
      });
    });
  });

  describe("sanitizeRichText", () => {
    it("should allow basic formatting tags", () => {
      const input = "<p><b>Bold</b> and <i>italic</i></p>";
      const result = sanitizeRichText(input);

      expect(result).toContain("<p>");
      expect(result).toContain("<b>");
      expect(result).toContain("<i>");
    });

    it("should remove script tags", () => {
      const input = "<p>Text<script>alert(1)</script></p>";
      const result = sanitizeRichText(input);

      expect(result).toContain("<p>");
      expect(result).not.toContain("script");
    });

    it("should allow links with href", () => {
      const input = '<a href="https://example.com">Link</a>';
      const result = sanitizeRichText(input);

      expect(result).toContain("<a");
      expect(result).toContain("href");
    });

    it("should remove dangerous link hrefs", () => {
      const input = '<a href="javascript:alert(1)">Link</a>';
      const result = sanitizeRichText(input);

      expect(result).not.toContain("javascript:");
    });

    it("should enforce max length", () => {
      const longContent = "<p>" + "a".repeat(6000) + "</p>";
      expect(sanitizeRichText(longContent, 100)).toHaveLength(100);
    });

    it("should return empty string for null", () => {
      expect(sanitizeRichText(null)).toBe("");
    });

    it("should include all allowed tags", () => {
      // Verify our allowed tags list includes expected tags
      expect(RICH_TEXT_ALLOWED_TAGS).toContain("p");
      expect(RICH_TEXT_ALLOWED_TAGS).toContain("b");
      expect(RICH_TEXT_ALLOWED_TAGS).toContain("strong");
      expect(RICH_TEXT_ALLOWED_TAGS).toContain("ul");
      expect(RICH_TEXT_ALLOWED_TAGS).toContain("li");
    });
  });

  describe("sanitizeStringArray", () => {
    it("should sanitize each element", () => {
      const result = sanitizeStringArray([
        "<script>bad</script>",
        "good",
        "<b>bold</b>",
      ]);

      expect(result).toContain("good");
      expect(result).toContain("bold");
      expect(result).not.toContain("<script>");
    });

    it("should filter empty strings by default", () => {
      const result = sanitizeStringArray(["", "  ", "valid"]);

      expect(result).toHaveLength(1);
      expect(result).toContain("valid");
    });

    it("should keep empty strings when filterEmpty is false", () => {
      const result = sanitizeStringArray(["", "valid"], { filterEmpty: false });

      expect(result).toHaveLength(2);
    });

    it("should enforce maxItems limit", () => {
      const arr = Array(100).fill("item");
      const result = sanitizeStringArray(arr, { maxItems: 10 });

      expect(result).toHaveLength(10);
    });

    it("should return empty array for null", () => {
      expect(sanitizeStringArray(null)).toEqual([]);
    });

    it("should return empty array for undefined", () => {
      expect(sanitizeStringArray(undefined)).toEqual([]);
    });

    it("should pass through options to sanitizeString", () => {
      const result = sanitizeStringArray(["a".repeat(100)], { maxLength: 10 });

      expect(result[0]).toHaveLength(10);
    });
  });

  describe("validateEmailStrict", () => {
    describe("valid emails", () => {
      it("should accept standard email", () => {
        expect(validateEmailStrict("user@example.com")).toBe(true);
      });

      it("should accept email with subdomain", () => {
        expect(validateEmailStrict("user@mail.example.com")).toBe(true);
      });

      it("should accept email with plus sign", () => {
        expect(validateEmailStrict("user+tag@example.com")).toBe(true);
      });

      it("should accept email with dots in local part", () => {
        expect(validateEmailStrict("first.last@example.com")).toBe(true);
      });

      it("should accept email with numbers", () => {
        expect(validateEmailStrict("user123@example.com")).toBe(true);
      });

      it("should accept email with special characters", () => {
        expect(validateEmailStrict("user!#$%@example.com")).toBe(true);
      });
    });

    describe("invalid emails", () => {
      it("should reject null", () => {
        expect(validateEmailStrict(null)).toBe(false);
      });

      it("should reject undefined", () => {
        expect(validateEmailStrict(undefined)).toBe(false);
      });

      it("should reject empty string", () => {
        expect(validateEmailStrict("")).toBe(false);
      });

      it("should reject email without @", () => {
        expect(validateEmailStrict("userexample.com")).toBe(false);
      });

      it("should reject email without domain", () => {
        expect(validateEmailStrict("user@")).toBe(false);
      });

      it("should reject email without local part", () => {
        expect(validateEmailStrict("@example.com")).toBe(false);
      });

      it("should reject email longer than 254 chars", () => {
        const longEmail = "a".repeat(250) + "@test.com";
        expect(validateEmailStrict(longEmail)).toBe(false);
      });

      it("should reject email with local part > 64 chars", () => {
        const longLocal = "a".repeat(65) + "@test.com";
        expect(validateEmailStrict(longLocal)).toBe(false);
      });

      it("should reject consecutive dots in local part", () => {
        expect(validateEmailStrict("user..name@example.com")).toBe(false);
      });

      it("should reject domain without TLD", () => {
        expect(validateEmailStrict("user@localhost")).toBe(false);
      });
    });
  });

  describe("validateUrlStrict", () => {
    describe("valid URLs", () => {
      it("should accept https URL", () => {
        expect(validateUrlStrict("https://example.com")).toBe(true);
      });

      it("should accept http URL", () => {
        expect(validateUrlStrict("http://example.com")).toBe(true);
      });

      it("should accept URL with path", () => {
        expect(validateUrlStrict("https://example.com/path/to/page")).toBe(
          true
        );
      });

      it("should accept URL with query string", () => {
        expect(validateUrlStrict("https://example.com?foo=bar")).toBe(true);
      });

      it("should accept URL with port", () => {
        expect(validateUrlStrict("https://example.com:8080")).toBe(true);
      });
    });

    describe("invalid URLs", () => {
      it("should reject null", () => {
        expect(validateUrlStrict(null)).toBe(false);
      });

      it("should reject undefined", () => {
        expect(validateUrlStrict(undefined)).toBe(false);
      });

      it("should reject empty string", () => {
        expect(validateUrlStrict("")).toBe(false);
      });

      it("should reject javascript: protocol", () => {
        expect(validateUrlStrict("javascript:alert(1)")).toBe(false);
      });

      it("should reject data: protocol", () => {
        expect(validateUrlStrict("data:text/html,<script>")).toBe(false);
      });

      it("should reject file: protocol", () => {
        expect(validateUrlStrict("file:///etc/passwd")).toBe(false);
      });

      it("should reject ftp: protocol", () => {
        expect(validateUrlStrict("ftp://example.com")).toBe(false);
      });

      it("should reject malformed URL", () => {
        expect(validateUrlStrict("not a url")).toBe(false);
      });

      it("should reject URL without protocol", () => {
        expect(validateUrlStrict("example.com")).toBe(false);
      });
    });
  });

  describe("normalizeUrlStrict", () => {
    it("should add https to URL without protocol", () => {
      expect(normalizeUrlStrict("example.com")).toBe("https://example.com");
    });

    it("should preserve existing https", () => {
      expect(normalizeUrlStrict("https://example.com")).toBe(
        "https://example.com"
      );
    });

    it("should preserve existing http", () => {
      expect(normalizeUrlStrict("http://example.com")).toBe(
        "http://example.com"
      );
    });

    it("should trim whitespace", () => {
      expect(normalizeUrlStrict("  example.com  ")).toBe("https://example.com");
    });

    it("should return empty string for null", () => {
      expect(normalizeUrlStrict(null)).toBe("");
    });

    it("should return empty string for empty string", () => {
      expect(normalizeUrlStrict("")).toBe("");
    });

    it("should return empty string for whitespace only", () => {
      expect(normalizeUrlStrict("   ")).toBe("");
    });
  });

  describe("sanitizeContactInfo", () => {
    it("should sanitize all fields", () => {
      // Using <b> tag instead of <script> because DOMPurify removes
      // script tag contents entirely (they're treated as JS code)
      const result = sanitizeContactInfo({
        name: "<b>John</b>",
        email: "john@example.com",
        phone: "555-1234",
        website: "example.com",
        linkedin: "linkedin.com/in/john",
      });

      expect(result.name).toBe("John");
      expect(result.email).toBe("john@example.com");
      expect(result.phone).toBe("555-1234");
      expect(result.website).toBe("https://example.com");
      expect(result.linkedin).toBe("https://linkedin.com/in/john");
    });

    it("should return empty email for invalid email", () => {
      const result = sanitizeContactInfo({
        email: "invalid-email",
      });

      expect(result.email).toBe("");
    });

    it("should return empty website for invalid URL", () => {
      const result = sanitizeContactInfo({
        website: "javascript:alert(1)",
      });

      expect(result.website).toBe("");
    });

    it("should return empty object for null input", () => {
      const result = sanitizeContactInfo(null);

      expect(result).toEqual({
        name: "",
        email: "",
        phone: "",
        website: "",
        linkedin: "",
      });
    });

    it("should handle partial input", () => {
      const result = sanitizeContactInfo({
        name: "John",
      });

      expect(result.name).toBe("John");
      expect(result.email).toBe("");
      expect(result.phone).toBe("");
    });

    it("should enforce name max length", () => {
      const result = sanitizeContactInfo({
        name: "a".repeat(200),
      });

      expect(result.name).toHaveLength(100);
    });
  });

  describe("sanitizeSingleLine", () => {
    it("should remove newlines", () => {
      expect(sanitizeSingleLine("Hello\nWorld")).toBe("Hello World");
    });

    it("should remove carriage returns", () => {
      expect(sanitizeSingleLine("Hello\r\nWorld")).toBe("Hello World");
    });

    it("should normalize multiple spaces", () => {
      expect(sanitizeSingleLine("Hello    World")).toBe("Hello World");
    });

    it("should trim result", () => {
      expect(sanitizeSingleLine("  Hello  ")).toBe("Hello");
    });

    it("should enforce max length", () => {
      expect(sanitizeSingleLine("a".repeat(300), 100)).toHaveLength(100);
    });

    it("should handle null", () => {
      expect(sanitizeSingleLine(null)).toBe("");
    });
  });

  describe("containsXssPatterns", () => {
    it("should detect script tags", () => {
      expect(containsXssPatterns("<script>alert(1)</script>")).toBe(true);
    });

    it("should detect javascript protocol", () => {
      expect(containsXssPatterns("javascript:alert(1)")).toBe(true);
    });

    it("should detect data protocol", () => {
      expect(containsXssPatterns("data:text/html")).toBe(true);
    });

    it("should detect onclick handler", () => {
      expect(containsXssPatterns('onclick="alert(1)"')).toBe(true);
    });

    it("should detect onerror handler", () => {
      expect(containsXssPatterns('onerror="alert(1)"')).toBe(true);
    });

    it("should detect iframe", () => {
      expect(containsXssPatterns("<iframe src=")).toBe(true);
    });

    it("should detect HTML entities", () => {
      expect(containsXssPatterns("&#x3C;script")).toBe(true);
    });

    it("should return false for clean text", () => {
      expect(containsXssPatterns("Hello World")).toBe(false);
    });

    it("should return false for null", () => {
      expect(containsXssPatterns(null as any)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(containsXssPatterns(undefined as any)).toBe(false);
    });

    it("should detect case-insensitive patterns", () => {
      expect(containsXssPatterns("<SCRIPT>")).toBe(true);
      expect(containsXssPatterns("JAVASCRIPT:")).toBe(true);
    });
  });

  /**
   * EDGE CASE TESTS - Additional security and boundary tests
   */
  describe("Edge Cases and Security Boundaries", () => {
    describe("Unicode and encoding edge cases", () => {
      it("should handle UTF-8 multibyte characters", () => {
        expect(sanitizeString("こんにちは World 🌍")).toBe("こんにちは World 🌍");
      });

      it("should handle RTL text", () => {
        expect(sanitizeString("مرحبا Hello")).toBe("مرحبا Hello");
      });

      it("should handle zero-width characters", () => {
        // Zero-width space (U+200B) and zero-width joiner (U+200D)
        const result = sanitizeString("te\u200Bst");
        expect(result).not.toContain("<");
        expect(result).not.toContain(">");
      });

      it("should handle combining characters", () => {
        // e + combining acute accent stays as combining character
        // DOMPurify doesn't normalize unicode
        const result = sanitizeString("cafe\u0301");
        expect(result).toContain("caf");
        expect(result.length).toBeGreaterThanOrEqual(4);
      });
    });

    describe("Boundary length cases", () => {
      it("should handle exactly max length", () => {
        const exact = "a".repeat(1000);
        expect(sanitizeString(exact)).toHaveLength(1000);
      });

      it("should truncate to exactly max length", () => {
        const long = "a".repeat(1001);
        expect(sanitizeString(long)).toHaveLength(1000);
      });

      it("should handle custom max length of 1", () => {
        expect(sanitizeString("Hello", { maxLength: 1 })).toBe("H");
      });

      it("should handle custom max length of 0", () => {
        expect(sanitizeString("Hello", { maxLength: 0 })).toBe("");
      });
    });

    describe("Advanced XSS vectors", () => {
      it("should handle SVG-based XSS", () => {
        const svg = '<svg><animate onbegin="alert(1)"></animate></svg>';
        const result = sanitizeString(svg);
        expect(result).not.toContain("onbegin");
        expect(result).not.toContain("<svg");
      });

      it("should handle meta refresh", () => {
        const meta = '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">';
        const result = sanitizeString(meta);
        expect(result).not.toContain("javascript:");
        expect(result).not.toContain("<meta");
      });

      it("should handle CSS expression", () => {
        const css = '<div style="background:expression(alert(1))">test</div>';
        const result = sanitizeString(css);
        expect(result).not.toContain("expression");
      });

      it("should handle base tag injection", () => {
        const base = '<base href="javascript:alert(1)//"><a href="/path">click</a>';
        const result = sanitizeString(base);
        expect(result).not.toContain("javascript:");
        expect(result).not.toContain("<base");
      });

      it("should handle object/embed tags", () => {
        const obj = '<object data="data:text/html,<script>alert(1)</script>">';
        const result = sanitizeString(obj);
        expect(result).not.toContain("<object");
        expect(result).not.toContain("data:");
      });

      it("should handle form action injection", () => {
        const form = '<form action="javascript:alert(1)"><input type="submit"></form>';
        const result = sanitizeString(form);
        expect(result).not.toContain("javascript:");
        expect(result).not.toContain("<form");
      });
    });

    describe("Email validation edge cases", () => {
      it("should handle email with all valid special characters", () => {
        expect(validateEmailStrict("user+tag.label!#$%&'*=?^_`{|}~@example.com")).toBe(true);
      });

      it("should handle local part at exactly 64 characters", () => {
        const local = "a".repeat(64);
        expect(validateEmailStrict(`${local}@test.com`)).toBe(true);
      });

      it("should accept email with leading dot in local part (RFC allows)", () => {
        // Current regex accepts this - documenting actual behavior
        expect(validateEmailStrict(".user@example.com")).toBe(true);
      });

      it("should accept email with trailing dot in local part", () => {
        // Current regex accepts this - documenting actual behavior
        expect(validateEmailStrict("user.@example.com")).toBe(true);
      });

      it("should handle email with IP address domain", () => {
        // RFC allows IP addresses but our regex doesn't support bracket notation
        const result = validateEmailStrict("user@[192.168.1.1]");
        expect(result).toBe(false); // IP addresses with brackets not supported
      });

      it("should reject international domain names (ASCII only)", () => {
        // Current regex only supports ASCII domains
        expect(validateEmailStrict("user@münchen.de")).toBe(false);
      });

      it("should reject email at exactly 255 characters", () => {
        const local = "a".repeat(63);
        const domain = "b".repeat(255 - 64 - 1); // Total 255
        expect(validateEmailStrict(`${local}@${domain}.com`)).toBe(false);
      });
    });

    describe("URL validation edge cases", () => {
      it("should handle URL with authentication", () => {
        expect(validateUrlStrict("https://user:pass@example.com")).toBe(true);
      });

      it("should handle URL with fragment", () => {
        expect(validateUrlStrict("https://example.com#section")).toBe(true);
      });

      it("should handle URL with port 0", () => {
        expect(validateUrlStrict("https://example.com:0")).toBe(true);
      });

      it("should handle URL with port 65535", () => {
        expect(validateUrlStrict("https://example.com:65535")).toBe(true);
      });

      it("should reject vbscript protocol", () => {
        expect(validateUrlStrict("vbscript:msgbox(1)")).toBe(false);
      });

      it("should reject blob protocol", () => {
        expect(validateUrlStrict("blob:https://example.com/uuid")).toBe(false);
      });

      it("should handle URL with encoded characters", () => {
        expect(validateUrlStrict("https://example.com/path%20with%20spaces")).toBe(true);
      });

      it("should handle localhost URLs", () => {
        expect(validateUrlStrict("http://localhost")).toBe(true);
        expect(validateUrlStrict("https://localhost:3000")).toBe(true);
      });
    });

    describe("Array sanitization edge cases", () => {
      it("should handle array with mixed types", () => {
        const mixed = ["valid", 123 as any, null as any, undefined as any, "also valid"];
        const result = sanitizeStringArray(mixed);
        expect(result).toContain("valid");
        expect(result).toContain("also valid");
      });

      it("should handle nested arrays", () => {
        const nested = [["nested"] as any, "flat"];
        const result = sanitizeStringArray(nested);
        // Should handle gracefully
        expect(Array.isArray(result)).toBe(true);
      });

      it("should handle very large array", () => {
        const large = Array(1000).fill("item");
        const result = sanitizeStringArray(large, { maxItems: 50 });
        expect(result).toHaveLength(50);
      });

      it("should handle array with only XSS content", () => {
        const xss = ["<script>1</script>", "<script>2</script>"];
        const result = sanitizeStringArray(xss);
        expect(result).toHaveLength(0);
      });
    });

    describe("Contact info edge cases", () => {
      it("should handle contact info with XSS in all fields", () => {
        const result = sanitizeContactInfo({
          name: "<script>alert(1)</script>",
          email: "javascript:void(0)",
          phone: "<img onerror=alert(1)>",
          website: "javascript:alert(1)",
          linkedin: "data:text/html,<script>",
        });

        expect(result.name).toBe("");
        expect(result.email).toBe("");
        expect(result.phone).toBe("");
        expect(result.website).toBe("");
        expect(result.linkedin).toBe("");
      });

      it("should preserve valid website with query parameters", () => {
        const result = sanitizeContactInfo({
          website: "https://example.com?utm_source=test&utm_campaign=demo",
        });

        expect(result.website).toContain("https://example.com");
        expect(result.website).toContain("utm_source");
      });

      it("should handle LinkedIn URL variations", () => {
        const result1 = sanitizeContactInfo({
          linkedin: "linkedin.com/in/john-doe",
        });
        expect(result1.linkedin).toBe("https://linkedin.com/in/john-doe");

        const result2 = sanitizeContactInfo({
          linkedin: "https://www.linkedin.com/company/acme",
        });
        expect(result2.linkedin).toBe("https://www.linkedin.com/company/acme");
      });
    });

    describe("Single line sanitization edge cases", () => {
      it("should handle multiple consecutive newlines", () => {
        expect(sanitizeSingleLine("Hello\n\n\n\nWorld")).toBe("Hello World");
      });

      it("should handle Windows line endings", () => {
        expect(sanitizeSingleLine("Hello\r\n\r\nWorld")).toBe("Hello World");
      });

      it("should handle mixed line endings", () => {
        expect(sanitizeSingleLine("A\rB\nC\r\nD")).toBe("A B C D");
      });

      it("should handle tabs and spaces mixed", () => {
        expect(sanitizeSingleLine("Hello\t  \t  World")).toBe("Hello World");
      });

      it("should preserve single spaces between words", () => {
        expect(sanitizeSingleLine("Hello World")).toBe("Hello World");
      });
    });
  });
});
