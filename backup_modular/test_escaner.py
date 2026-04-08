import unittest
from escaner_fondo import vk_a_char, app
import json

class TestEscaner(unittest.TestCase):
    def setUp(self):
        self.app = app.test_client()
        self.app.testing = True

    def test_vk_a_char_alphanumeric(self):
        # Simular objeto key de pynput
        class Key:
            def __init__(self, char=None, vk=None):
                self.char = char
                self.vk = vk
        
        self.assertEqual(vk_a_char(Key(char='a')), 'A')
        self.assertEqual(vk_a_char(Key(char='1')), '1')
        self.assertEqual(vk_a_char(Key(vk=0x41)), 'A') # VK_A
        self.assertEqual(vk_a_char(Key(vk=0x30)), '0') # VK_0

    def test_vk_a_char_special(self):
        class Key:
            def __init__(self, char=None):
                self.char = char
        
        self.assertEqual(vk_a_char(Key(char='-')), '-')
        self.assertEqual(vk_a_char(Key(char='.')), '.')
        self.assertEqual(vk_a_char(Key(char='/')), '/')
        self.assertIsNone(vk_a_char(Key(char=' ')))

    def test_poll_endpoint(self):
        response = self.app.get('/poll')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('codigo', data)

    def test_status_endpoint(self):
        response = self.app.get('/status')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data['activo'])

if __name__ == '__main__':
    unittest.main()
