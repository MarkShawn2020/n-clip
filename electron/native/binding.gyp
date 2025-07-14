{
  "targets": [
    {
      "target_name": "accessibility",
      "sources": [
        "accessibility.mm"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [
        "-fno-exceptions"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.15"
      },
      "link_settings": {
        "libraries": [
          "-framework ApplicationServices",
          "-framework CoreFoundation"
        ]
      },
      "conditions": [
        ['OS=="mac"', {
          "defines": [
            "NAPI_DISABLE_CPP_EXCEPTIONS"
          ]
        }]
      ]
    }
  ]
}