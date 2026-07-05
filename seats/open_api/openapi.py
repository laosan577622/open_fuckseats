from .registry import registry


def build_openapi_schema(base_url='/open_api'):
    tools = registry.schemas()
    tool_names = [tool['function']['name'] for tool in tools]
    return {
        'openapi': '3.0.3',
        'info': {
            'title': 'FuckSeats Open API',
            'version': '0.3.0',
            'description': '面向外部 Agent 的不想排座位开放接口。',
        },
        'servers': [{'url': base_url}],
        'security': [{'bearerAuth': []}],
        'paths': {
            '/': {
                'get': {
                    'summary': 'API 发现根节点',
                    'responses': {'200': {'description': 'OK'}},
                },
            },
            '/classrooms': {
                'get': {
                    'summary': '列出教室',
                    'responses': {'200': {'description': 'OK'}},
                },
            },
            '/classrooms/{id}': {
                'get': {
                    'summary': '教室详情',
                    'parameters': [{'name': 'id', 'in': 'path', 'required': True, 'schema': {'type': 'integer'}}],
                    'responses': {'200': {'description': 'OK'}},
                },
            },
            '/classrooms/{id}/enums': {
                'get': {
                    'summary': '枚举值',
                    'parameters': [{'name': 'id', 'in': 'path', 'required': True, 'schema': {'type': 'integer'}}],
                    'responses': {'200': {'description': 'OK'}},
                },
            },
            '/tools/execute': {
                'post': {
                    'summary': '执行单个工具',
                    'requestBody': {
                        'required': True,
                        'content': {
                            'application/json': {
                                'schema': {
                                    'type': 'object',
                                    'properties': {
                                        'tool': {'type': 'string', 'enum': tool_names},
                                        'classroom_id': {'type': 'integer'},
                                        'arguments': {'type': 'object'},
                                    },
                                    'required': ['tool'],
                                },
                            },
                        },
                    },
                    'responses': {'200': {'description': 'OK'}, '400': {'description': 'Error'}},
                },
            },
            '/tools/batch': {
                'post': {
                    'summary': '原子化批量执行工具',
                    'requestBody': {
                        'required': True,
                        'content': {
                            'application/json': {
                                'schema': {
                                    'type': 'object',
                                    'properties': {
                                        'classroom_id': {'type': 'integer'},
                                        'operations': {
                                            'type': 'array',
                                            'items': {
                                                'type': 'object',
                                                'properties': {
                                                    'tool': {'type': 'string', 'enum': tool_names},
                                                    'classroom_id': {'type': 'integer'},
                                                    'arguments': {'type': 'object'},
                                                },
                                                'required': ['tool'],
                                            },
                                        },
                                    },
                                    'required': ['operations'],
                                },
                            },
                        },
                    },
                    'responses': {'200': {'description': 'OK'}, '400': {'description': 'Error'}},
                },
            },
        },
        'components': {
            'securitySchemes': {
                'bearerAuth': {'type': 'http', 'scheme': 'bearer'},
            },
            'schemas': {
                'Tool': {'type': 'object'},
            },
        },
        'x-tools': tools,
    }
